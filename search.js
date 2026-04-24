document.addEventListener('DOMContentLoaded', () => {
  // =========================================================
  // STEP 1) Grab DOM elements
  // =========================================================
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');
  const resultsContainer = document.querySelector('.product_list');

  if (!form || !input || !status || !suggestions || !resultsContainer) {
    console.warn('[Search] Missing required DOM elements. Check your HTML IDs/classes.');
    return;
  }

  // =========================================================
  // STEP 2) Configuration (edit these safely)
  // =========================================================
  // If DY scripts are installed on the page, keep this false (script tracks pageviews).
  const IS_IMPLICIT_PAGEVIEW = false;

  // Debounce time for search-as-you-type
  const TYPE_DEBOUNCE_MS = 300;

  // Minimum characters before calling search when typing
  const MIN_QUERY_LEN = 1;

  // Initial page load behavior:
  // Use a safe default keyword query (avoids 400s from empty query setups).
  const DEFAULT_INITIAL_QUERY = 'shirt';

  // How many products to request per call
  const PAGE_SIZE = 12;
  const PAGE_OFFSET = 0;

  // =========================================================
  // STEP 3) Cookie helpers (DY identifiers may be null on first load)
  // =========================================================
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }

  function getDyIdentifiers() {
    // NOTE: Depending on implementation, cookie names can be dyid vs _dyid.
    // Your original code uses dyid, dyid_server, dyjsession. We’ll keep those,
    // but also try the underscore versions as a fallback.
    return {
      dyid: getCookie('_dyid'),
      dyid_server: getCookie('_dyid'),
      dyjsession: getCookie('_dyjsession')
      console.log(dyid, dyid_server, dyjsession)
    };
  }

  // =========================================================
  // STEP 4) Escape helper (safe rendering)
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
  // STEP 5) Render products (DY owns the list)
  // Adjust field mapping based on your feed/response shape.
  // =========================================================
  function renderProducts(items) {
    resultsContainer.innerHTML = '';

    items.forEach((item) => {
      const name = item?.name ?? item?.title ?? item?.productName ?? '';
      const price = item?.price ?? item?.itemPrice ?? item?.salePrice ?? null;
      const url = item?.url ?? item?.link ?? item?.productUrl ?? '#';
      const image = item?.image ?? item?.imageUrl ?? item?.img ?? '';
      const meta = item?.meta ?? item?.category ?? item?.brand ?? '';

      const card = document.createElement('div');
      card.className = 'product_card';

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
  // STEP 6) Extract items from DY response
  // Different templates can place items in different locations.
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
  // STEP 7) Console logging (request + response + extracted items)
  // =========================================================
  function logDy(label, payload, responseJson) {
    console.groupCollapsed(`[DY Search] ${label}`);
    console.log('Identifiers (from cookies):', getDyIdentifiers());
    console.log('Request payload:', payload);
    console.log('Raw response:', responseJson);

    const extracted = extractItemsFromDyResponse(responseJson);
    console.log('Extracted items count:', extracted.length);
    console.log('Extracted items sample (first 3):', extracted.slice(0, 3));

    const choice = responseJson?.choices?.[0];
    const variation = choice?.variations?.[0];
    console.log('choices[0].type:', choice?.type);
    console.log('variation payload keys:', variation?.payload ? Object.keys(variation.payload) : null);
    console.groupEnd();
  }

  // =========================================================
  // STEP 8) Build user/session objects WITHOUT nulls
  // This prevents 400 Bad Request when dyid/dyid_server are null. [1](https://support.dynamicyield.com/hc/en-us/articles/28833403680925-Creating-Semantic-Search-Campaigns)
  // =========================================================
  function buildUserAndSession() {
    const { dyid, dyid_server, dyjsession } = getDyIdentifiers();

    // Always include consent flag, but only include IDs if truthy
    const user = { active_consent_accepted: true };
    if (dyid) user.dyid = dyid;
    if (dyid_server) user.dyid_server = dyid_server;

    const session = {};
    if (dyjsession) session.dy = dyjsession;

    return { user, session };
  }

  // =========================================================
  // STEP 9) Run DY Search API (with AbortController for typing)
  // The Search API requires a Query object; we include pagination each time. [1](https://support.dynamicyield.com/hc/en-us/articles/28833403680925-Creating-Semantic-Search-Campaigns)
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(queryText, logLabel) {
    // Cancel any previous request (prevents race conditions on fast typing)
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const { user, session } = buildUserAndSession();

    // Build payload
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
        // IMPORTANT: Always send a string (avoid null/undefined)
        text: String(queryText),
        pagination: { numItems: PAGE_SIZE, offset: PAGE_OFFSET }
      },
      user,
      session
    };

    // Also: if session is empty object, you can delete it (optional)
    if (!Object.keys(session).length) delete payload.session;

    // Debug: show payload BEFORE sending
    console.log('[DY Search] Sending payload:', payload);

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

    // If 400, log response body for the exact reason (super useful)
    if (!res.ok) {
      let errBody = '';
      try { errBody = await res.text(); } catch (_) {}
      console.error('[DY Search] HTTP Error:', res.status, errBody);
      throw new Error(`DY Search failed (HTTP ${res.status})`);
    }

    const json = await res.json();

    // Console logs so you can inspect it
    logDy(logLabel, payload, json);

    return json;
  }

  // =========================================================
  // STEP 10) Execute search + render
  // =========================================================
  async function doSearch(query, labelOverride) {
    const q = String(query).trim();

    // Enforce minimum query length for user-typed searches
    if (q.length < MIN_QUERY_LEN) {
      return { ok: true, items: [], query: q };
    }

    status.textContent = 'Searching…';

    try {
      const dyResponse = await runDySemanticSearch(q, labelOverride ?? `Query="${q}"`);
      const items = extractItemsFromDyResponse(dyResponse);

      renderProducts(items);
      status.textContent = `${items.length} result(s) for "${q}".`;

      return { ok: true, items, query: q };
    } catch (err) {
      // AbortError is normal when user types again quickly
      if (err.name === 'AbortError') return { ok: false, aborted: true, items: [], query: q };

      console.error('[DY Search] Search error:', err);
      status.textContent = 'Search failed. Please try again.';
      return { ok: false, items: [], query: q };
    }
  }

  // =========================================================
  // STEP 11) Best-practice initial load
  // Load an initial product list when the user lands on the page.
  // We avoid empty query by default to prevent 400s in many configs. [1](https://support.dynamicyield.com/hc/en-us/articles/28833403680925-Creating-Semantic-Search-Campaigns)
  // =========================================================
  async function initialLoad() {
    status.textContent = 'Loading products…';
    const q = DEFAULT_INITIAL_QUERY;

    try {
      const dyResponse = await runDySemanticSearch(q, `Initial load: "${q}"`);
      const items = extractItemsFromDyResponse(dyResponse);

      renderProducts(items);
      status.textContent = `${items.length} product(s) loaded.`;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[DY Search] Initial load failed:', err);
      status.textContent = 'Failed to load products.';
    }
  }

  // =========================================================
  // STEP 12) Search-as-you-type (debounced)
  // =========================================================
  let debounceTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();

    // Hide suggestions (you’re not populating suggestions yet)
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    // If cleared: cancel request + clear UI
    if (!q) {
      if (activeController) activeController.abort();
      resultsContainer.innerHTML = '';
      status.textContent = '';
      return;
    }

    // Debounce calls to avoid hitting API every keystroke
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (q.length >= MIN_QUERY_LEN) {
        doSearch(q, `Typing: "${q}"`);
      }
    }, TYPE_DEBOUNCE_MS);
  });

  // =========================================================
  // STEP 13) Submit search (Enter key / button)
  // =========================================================
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    const q = input.value.trim();
    if (!q) return;

    clearTimeout(debounceTimer);
    doSearch(q, `Submit: "${q}"`);
  });

  // =========================================================
  // STEP 14) Suggestion click (optional support)
  // =========================================================
  suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;

    input.value = li.dataset.value;
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    clearTimeout(debounceTimer);
    doSearch(input.value.trim(), `Suggestion: "${input.value.trim()}"`);
  });

  // =========================================================
  // STEP 15) Kick off initial load
  // =========================================================
  initialLoad();
});
