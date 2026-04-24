document.addEventListener('DOMContentLoaded', () => {
  // =========================================================
  // STEP 1) Grab all required DOM elements
  // =========================================================
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');
  const resultsContainer = document.querySelector('.product_list');

  // If any required element is missing, stop safely.
  if (!form || !input || !status || !suggestions || !resultsContainer) return;

  // =========================================================
  // STEP 2) Configuration toggles
  // =========================================================
  // If DY script is installed on the page (you have api_dynamic.js/api_static.js),
  // pageviews are usually already tracked by the script, so keep this FALSE.
  // If you are fully API-based (no DY script), set TRUE.
  const IS_IMPLICIT_PAGEVIEW = false; 

  // How long to wait after the last keystroke before searching:
  const TYPE_DEBOUNCE_MS = 300;

  // Optional: minimum characters before we start searching
  const MIN_QUERY_LEN = 1;

  // =========================================================
  // STEP 3) Cookie helpers for DY identifiers (dyid, dyid_server, dyjsession)
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
  // STEP 4) Basic HTML escaping to safely render text
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
  // STEP 5) Render results returned by DY (DY owns the product list)
  // IMPORTANT: This assumes DY returns items with fields like name/price/url/image
  // If your feed uses different field names, update mapping below.
  // =========================================================
  function renderProducts(items) {
    resultsContainer.innerHTML = '';

    items.forEach(item => {
      const name = item?.name ?? item?.title ?? '';
      const price = item?.price ?? item?.itemPrice ?? item?.salePrice ?? null;
      const url = item?.url ?? item?.link ?? '#';
      const image = item?.image ?? item?.imageUrl ?? item?.img ?? '';
      const meta = item?.meta ?? item?.category ?? '';

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
  // STEP 6) Extract "items" safely from DY Search response
  // The Search API returns "choices" with variations, but payload structure
  // can differ depending on setup/template. This tries common shapes. [2](https://dy.dev/reference/search)
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
  // STEP 7) Run DY Semantic Search request (with request cancellation)
  // Uses /v2/serve/user/search endpoint. [2](https://dy.dev/reference/search)
  // Includes isImplicitPageview and device.userAgent as per guidance. [1](https://mastercard.sharepoint.com/sites/DynamicYield-All/_layouts/15/Doc.aspx?sourcedoc=%7B479D5E62-5D77-482E-AD2D-39DA0CEDED8A%7D&file=Technical%20Kickoff%20-%20Semantic%20Search_Last%20Updated%20February%202026.pptx&action=edit&mobileredirect=true&DefaultItemOpen=1)
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(query) {
    // Cancel the previous request (if user typed again)
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
        text: query,
        pagination: { numItems: 10, offset: 0 }
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

    const response = await fetch('https://direct.dy-api.com/v2/serve/user/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DY-API-Key': '115d8bef0694cd3d125fb38e0ee5cba9f241403914493b144e36ddf885a4dbb9'
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: activeController.signal
    });

    if (!response.ok) {
      throw new Error('DY Semantic Search request failed');
    }

    return response.json();
  }

  // =========================================================
  // STEP 8) Main search flow:
  // - Shows "Searching…" but DOES NOT clear current results immediately
  // - When response arrives, replaces results
  // - Fixes the weird control characters by using normal quotes
  // =========================================================
  async function doSearch(query) {
    const safeQuery = query.trim();

    // If query is too short, don't search
    if (safeQuery.length < MIN_QUERY_LEN) return;

    // Show searching state (no control chars)
    status.textContent = 'Searching…';

    try {
      const dyResponse = await runDySemanticSearch(safeQuery);
      const items = extractItemsFromDyResponse(dyResponse);

      // Replace results only after we have the new items
      renderProducts(items);

      status.textContent = `${items.length} result(s) for "${safeQuery}".`;
    } catch (err) {
      // If it was aborted, ignore silently (user typed again)
      if (err.name === 'AbortError') return;

      console.error(err);
      status.textContent = 'Search failed. Please try again.';
    }
  }

  // =========================================================
  // STEP 9) Debounced "search while typing"
  // - This is what makes tiles update as you type
  // - It does NOT wipe the page instantly; results update after DY responds
  // =========================================================
  let debounceTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();

    // Hide suggestions UI (you can keep your existing suggestions logic if you add it later)
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    // If query cleared, clear results + status and cancel any in-flight request
    if (!q) {
      if (activeController) activeController.abort();
      resultsContainer.innerHTML = '';
      status.textContent = '';
      return;
    }

    // Debounce search calls
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      doSearch(q);
    }, TYPE_DEBOUNCE_MS);
  });

  // =========================================================
  // STEP 10) Form submit still works (Enter key / button)
  // =========================================================
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    const q = input.value.trim();
    if (!q) return;

    // Force immediate search on submit (no debounce delay)
    clearTimeout(debounceTimer);
    doSearch(q);
  });

  // =========================================================
  // STEP 11) Optional: clicking a suggestion triggers search
  // (Your suggestions list is empty right now, but this keeps compatibility)
  // =========================================================
  suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;

    input.value = li.dataset.value;
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    clearTimeout(debounceTimer);
    doSearch(input.value.trim());
  });
});
