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
  // STEP 2) Config
  // =========================================================
  const IS_IMPLICIT_PAGEVIEW = false; // DY scripts present => keep false
  const TYPE_DEBOUNCE_MS = 300;
  const MIN_QUERY_LEN = 1;

  const DEFAULT_INITIAL_QUERY = 'shirt';
  const PAGE_SIZE = 12;
  const PAGE_OFFSET = 0;

  // =========================================================
  // STEP 3) Cookie reader (reads from browser cookie storage)
  // =========================================================
  function getCookie(name) {
    const all = document.cookie ? document.cookie.split('; ') : [];
    for (const part of all) {
      const eqIndex = part.indexOf('=');
      if (eqIndex === -1) continue;
      const key = part.slice(0, eqIndex);
      const val = part.slice(eqIndex + 1);
      if (key === name) return decodeURIComponent(val);
    }
    return null;
  }

  // =========================================================
  // STEP 4) Fetch DY identifiers from cookies (and log them)
  // - Uses exactly: _dyid and _dyjsession
  // - If cookies are not available yet, fallback to window.DY values if present
  // =========================================================
  function getDyIdentifiers() {
    // Explicit variables as requested
    const dyidFromCookie = getCookie('_dyid');
    const dySessionFromCookie = getCookie('_dyjsession');

    // Optional fallback (helps when cookies aren't set yet at script time)
    const dyidFromWindow = window.DY && window.DY.dyid ? String(window.DY.dyid) : null;
    const dySessionFromWindow = window.DY && window.DY.jsession ? String(window.DY.jsession) : null;

    // Choose cookie first; if missing, use window fallback
    const dyid = dyidFromCookie || dyidFromWindow;
    const dyjsession = dySessionFromCookie || dySessionFromWindow;

    console.log('[DY Cookies fetched]', {
      _dyid: dyidFromCookie,
      _dyjsession: dySessionFromCookie,
      fallback_DY_dyid: dyidFromWindow,
      fallback_DY_jsession: dySessionFromWindow,
      chosen_dyid: dyid,
      chosen_dyjsession: dyjsession
    });

    return { dyid, dyjsession };
  }

  // =========================================================
  // STEP 5) Escape helper (safe rendering)
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
  // STEP 6) Render products
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
  // STEP 7) Extract items from DY response (payload shapes vary)
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
  // STEP 8) Build payload in EXACT format you requested
  // - user.dyid populated from _dyid (or fallback DY.dyid)
  // - session.dy populated from _dyjsession (or fallback DY.jsession)
  // - dyid_server excluded
  // =========================================================
  function buildPayload(queryText) {
    const { dyid, dyjsession } = getDyIdentifiers();

    // IMPORTANT: You requested dyid and session "need to be defined" in the payload.
    // So we always include user + session objects, even if values are missing.
    // But note: if they are empty, DY may reject; the console log will show it.
    const payload = {
      user: {
        dyid: dyid ? String(dyid) : ''
      },
      session: {
        dy: dyjsession ? String(dyjsession) : ''
      },
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
        text: String(queryText),
        pagination: { numItems: PAGE_SIZE, offset: PAGE_OFFSET }
      }
    };

    console.log('[DY Final Payload]', payload);
    return payload;
  }

  // =========================================================
  // STEP 9) Call DY Search API (AbortController for fast typing)
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(queryText, logLabel) {
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const payload = buildPayload(queryText);

    console.groupCollapsed(`[DY Search] ${logLabel}`);
    console.log('Sending payload:', payload);
    console.groupEnd();

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
      let errBody = '';
      try { errBody = await res.text(); } catch (_) {}
      console.error('[DY Search] HTTP Error:', res.status, errBody);
      throw new Error(`DY Search failed (HTTP ${res.status})`);
    }

    const json = await res.json();

    console.groupCollapsed(`[DY Search] Response: ${logLabel}`);
    console.log('Raw response:', json);
    const extracted = extractItemsFromDyResponse(json);
    console.log('Extracted items count:', extracted.length);
    console.log('Extracted items sample (first 3):', extracted.slice(0, 3));
    console.groupEnd();

    return json;
  }

  // =========================================================
  // STEP 10) Execute search + render
  // =========================================================
  async function doSearch(query, labelOverride) {
    const q = String(query).trim();

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
      if (err.name === 'AbortError') return { ok: false, aborted: true, items: [], query: q };
      console.error('[DY Search] Search error:', err);
      status.textContent = 'Search failed. Please try again.';
      return { ok: false, items: [], query: q };
    }
  }

  // =========================================================
  // STEP 11) Initial load (loads a list on landing)
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

    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');

    if (!q) {
      if (activeController) activeController.abort();
      resultsContainer.innerHTML = '';
      status.textContent = '';
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (q.length >= MIN_QUERY_LEN) {
        doSearch(q, `Typing: "${q}"`);
      }
    }, TYPE_DEBOUNCE_MS);
  });

  // =========================================================
  // STEP 13) Submit search
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
  // STEP 14) Suggestion click (optional)
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
