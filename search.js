document.addEventListener('DOMContentLoaded', () => {
  // =========================================================
  // STEP 1) Get references to the DOM elements we will use.
  // If any are missing, stop so we don't throw errors.
  // =========================================================
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');
  const resultsContainer = document.querySelector('.product_list');

  if (!form || !input || !status || !suggestions || !resultsContainer) {
    console.warn('[Search] Missing required DOM elements. Check IDs/classes in HTML.');
    return;
  }

  // =========================================================
  // STEP 2) Configuration (tune these without touching logic)
  // =========================================================
  // If DY script is on the page (api_dynamic.js / api_static.js), keep this false.
  // If you're fully API-based with no script, set true.
  const IS_IMPLICIT_PAGEVIEW = false;

  // Debounce delay for "search as you type"
  const TYPE_DEBOUNCE_MS = 300;

  // Minimum characters before we run a search from typing
  const MIN_QUERY_LEN = 1;

  // Best-practice initial load:
  // 1) Try empty query (works when experience targets empty queries / PLP approach). 
  // 2) If empty query returns 0, fallback to a default keyword (safer because text is generally mandatory). 
  const INITIAL_TRY_EMPTY_QUERY = true;
  const DEFAULT_FALLBACK_QUERY = 'shirt';

  // Pagination requested from DY
  const PAGE_SIZE = 10;
  const PAGE_OFFSET = 0;

  // =========================================================
  // STEP 3) DY cookie helpers: dyid, dyid_server, dyjsession
  // =========================================================
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function getDyIdentifiers() {
    return {
      dyid: getCookie('dyid'),
      dyid_server: getCookie('dyid_server'),
      sessionDy: getCookie('dyjsession')
    };
  }

  // =========================================================
  // STEP 4) Escape HTML to prevent accidental HTML injection
  // =========================================================
  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // =========================================================
  // STEP 5) Render products into the .product_list container
  // This assumes DY returns usable fields; if not, it still renders safely.
  // =========================================================
  function renderProducts(items) {
    resultsContainer.innerHTML = '';

    items.forEach(item => {
      // Try common field names; you may adjust these to match your feed output
      const name = item?.name ?? item?.title ?? item?.productName ?? '';
      const price = item?.price ?? item?.itemPrice ?? item?.salePrice ?? null;
      const url = item?.url ?? item?.link ?? item?.productUrl ?? '#';
      const image = item?.image ?? item?.imageUrl ?? item?.img ?? '';
      const meta = item?.meta ?? item?.category ?? item?.brand ?? '';

      const card = document.createElement('div');
      card.className = 'product_card';

      // Note: we intentionally do NOT trust these values as HTML; we escape everything.
      card.innerHTML = `
        ${escapeHtml(url)}
          ${image ? `${escapeHtml(image)}" loading="lazy">` : ''}
          <h3 class="product_title">${escapeHtml(name)}</h3>
        </a>
        ${meta ? `<p class="product_meta">${escapeHtml(meta)}</p>` : ''}
        ${price != null ? `<p class="product_price">$${escapeHtml(String(price))}</p>` : ''}
      `;

      resultsContainer.appendChild(card);
    });
  }

  // =========================================================
  // STEP 6) Extract items from the DY response.
  // DY response payload can vary by template/experience; we check common paths.
  // =========================================================
  function extractItemsFromDyResponse(dyResponse) {
    const choice = dyResponse?.choices?.[0];
    const variation = choice?.variations?.[0];

    const items =
      variation?.payload?.items ??
      variation?.payload?.data?.items ??
      variation?.payload?.products ??
      choice?.decision?.items ??
      [];

    return Array.isArray(items) ? items : [];
  }

  // =========================================================
  // STEP 7) Logging helper: prints request + response + extracted items
  // =========================================================
  function logDySearch(label, payload, responseJson) {
    console.groupCollapsed(`[DY Search] ${label}`);
    console.log('Request payload:', payload);
    console.log('Raw response:', responseJson);

    const choice = responseJson?.choices?.[0];
    const variation = choice?.variations?.[0];
    const extracted = extractItemsFromDyResponse(responseJson);

    console.log('choices[0].type:', choice?.type);
    console.log('variation info:', {
      id: variation?.id,
      name: variation?.name
    });
    console.log('payload keys:', variation?.payload ? Object.keys(variation.payload) : null);
    console.log('Extracted items count:', extracted.length);
    console.log('Extracted items sample (first 3):', extracted.slice(0, 3));
    console.groupEnd();
  }

  // =========================================================
  // STEP 8) Make the Search API call.
  // - Uses AbortController to cancel old requests when user types quickly.
  // - Adds device.userAgent and options.isImplicitPageview per guidance. 
  // - Adds cache: 'no-store' so browser doesn’t reuse cached results.
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(queryText, logLabel) {
    // Cancel any previous in-flight request
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const { dyid, dyid_server, sessionDy } = getDyIdentifiers();

    const payload = {
      selector: { name: 'Semantic Search' },
      context: {
        page: {
          type: 'OTHER',
          data: ['search'],
          locale: 'en_US',
          location: window.location.href,
          referrer: document.referrer
        },
        device: { userAgent: navigator.userAgent }
      },
      options: {
        isImplicitClientData: false,
        returnAnalyticsMetadata: false,
        isImplicitPageview: IS_IMPLICIT_PAGEVIEW
      },
      query: {
        text: queryText,
        pagination: { numItems: PAGE_SIZE, offset: PAGE_OFFSET }
      },
      user: {
        dyid,
        dyid_server,
        active_consent_accepted: true
      },
      session: {
        dy: sessionDy
      }
    };

    const res = await fetch('https://direct.dy-api.com/v2/serve/user/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DY-API-Key': 'HIDDEN'
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: activeController.signal
    });

    if (!res.ok) {
      throw new Error(`DY Search failed (HTTP ${res.status})`);
    }

    const json = await res.json();

    // Log everything so you can debug in DevTools
    logDySearch(logLabel, payload, json);

    return json;
  }

  // =========================================================
  // STEP 9) Execute a search and render results.
  // - Shows "Searching..." while waiting.
  // - Does NOT include strange control characters in status text.
  // - Ignores AbortError (normal during fast typing).
  // =========================================================
  async function doSearch(query, logLabelOverride) {
    const q = query.trim();

    // For user typing, we enforce MIN_QUERY_LEN.
    // For initial load, we may intentionally call with empty query.
    if (q.length < MIN_QUERY_LEN && q !== '') {
      return { ok: true, items: [], query: q };
    }

    status.textContent = q ? 'Searching…' : 'Loading products…';

    try {
      const dyResponse = await runDySemanticSearch(q, logLabelOverride ?? `Query="${q}"`);
      const items = extractItemsFromDyResponse(dyResponse);

      renderProducts(items);

      // Clean status message (no weird control characters)
      if (q) status.textContent = `${items.length} result(s) for "${q}".`;
      else status.textContent = `${items.length} product(s) loaded.`;

      return { ok: true, items, query: q };
    } catch (err) {
      if (err.name === 'AbortError') {
        // This happens when user types again quickly; ignore.
        return { ok: false, aborted: true, items: [], query: q };
      }
      console.error('[DY Search] Error:', err);
      status.textContent = 'Search failed. Please try again.';
      return { ok: false, items: [], query: q };
    }
  }

  // =========================================================
  // STEP 10) Best-practice initial load:
  // 1) Try empty query first (works if your DY experience supports it / PLP approach). 
  // 2) If 0 results, fallback to DEFAULT_FALLBACK_QUERY.
  // =========================================================
  async function initialLoad() {
    status.textContent = 'Loading products…';

    // Attempt #1: empty query
    let items = [];
    if (INITIAL_TRY_EMPTY_QUERY) {
      const r1 = await doSearch('', 'Initial load: empty query');
      items = r1.items || [];
    }

    // Attempt #2: fallback keyword if empty query gave 0
    if (!items.length) {
      await doSearch(DEFAULT_FALLBACK_QUERY, `Initial load: fallback query="${DEFAULT_FALLBACK_QUERY}"`);
    }
  }

  // =========================================================
  // STEP 11) "Search as you type" with debounce:
  // - Doesn’t instantly wipe results (prevents flicker)
  // - Cancels old requests when user keeps typing
  // =========================================================
  let debounceTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();

    // Hide suggestions UI for now (you’re not populating it yet)
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    // If user clears the search box:
    // - cancel any in-flight request
    // - clear results and status
    if (!q) {
      if (activeController) activeController.abort();
      resultsContainer.innerHTML = '';
      status.textContent = '';
      return;
    }

    // Debounce to avoid spamming API on every keystroke
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Only run if query meets minimum length
      if (q.length >= MIN_QUERY_LEN) {
        doSearch(q, `Typing search: "${q}"`);
      }
    }, TYPE_DEBOUNCE_MS);
  });

  // =========================================================
  // STEP 12) Form submit (Enter key / Search button):
  // - forces an immediate search (no debounce delay)
  // =========================================================
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    const q = input.value.trim();
    if (!q) return;

    clearTimeout(debounceTimer);
    doSearch(q, `Submit search: "${q}"`);
  });

  // =========================================================
  // STEP 13) Suggestion click support (if you implement suggestions later)
  // =========================================================
  suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;

    input.value = li.dataset.value;
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    clearTimeout(debounceTimer);
    doSearch(input.value.trim(), `Suggestion click search: "${input.value.trim()}"`);
  });

  // =========================================================
  // STEP 14) Run initial load on first entry to the page
  // =========================================================
  initialLoad();
});
