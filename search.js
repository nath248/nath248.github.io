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
  const IS_IMPLICIT_PAGEVIEW = false;     // DY scripts present => keep false
  const TYPE_DEBOUNCE_MS = 300;
  const MIN_QUERY_LEN = 1;

  const DEFAULT_INITIAL_QUERY = 'shirt';  // Safe initial query (avoids empty-query issues)
  const PAGE_SIZE = 12;
  const PAGE_OFFSET = 0;

  // =========================================================
  // STEP 3) Cookie helpers (reads from browser cookie storage)
  // =========================================================
  function getCookie(name) {
    // Safer cookie parsing than regex: split document.cookie into key/value pairs
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

  function getDyIdentifiers() {
    // Explicitly read the cookie names you said exist in your browser:
    const dyid = getCookie('_dyid');
    const dyjsession = getCookie('_dyjsession');

    // Console log when fetched so you can confirm values are correct
    console.log('[DY Cookies fetched]', { dyid, dyjsession });
    // Optional extra debug if you want to see the full cookie string:
    // console.log('[document.cookie]', document.cookie);

    return { dyid, dyjsession };
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
  // =========================================================
  function renderProducts(items) {
    resultsContainer.innerHTML = '';

    items.forEach((item) => {
      // Adjust mapping based on your feed/response fields
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
  // STEP 6) Extract items from DY response (payload shapes vary)
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
  // STEP 7) Build user/session
  // =========================================================
  function buildUserAndSession() {
    const { dyid, dyjsession } = getDyIdentifiers();

    const user = { active_consent_accepted: true };
    if (dyid) user.dyid = dyid;

    const session = {};
    if (dyjsession) session.dy = dyjsession;

    console.log('[DY Payload IDs]', { user, session });

    return { user, session };
  }

  // =========================================================
  // STEP 8) Run DY Search API (AbortController cancels old calls while typing)
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(queryText, logLabel) {
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const { user, session } = buildUserAndSession();

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
        text: String(queryText),
        pagination: { numItems: PAGE_SIZE, offset: PAGE_OFFSET }
      },
      user
    };

    // Only add session if we actually have one
    if (Object.keys(session).length) payload.session = session;

    console.groupCollapsed(`[DY Search] ${logLabel}`);
    console.log('Final request payload:', payload);
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

    // Log response + extracted items so you can verify rendering
    console.groupCollapsed(`[DY Search] Response: ${logLabel}`);
    console.log('Raw response:', json);
    const extracted = extractItemsFromDyResponse(json);
    console.log('Extracted items count:', extracted.length);
    console.log('Extracted items sample (first 3):', extracted.slice(0, 3));
    console.groupEnd();

    return json;
  }

  // =========================================================
  // STEP 9) Execute search + render
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
  // STEP 10) Initial load (loads a list on landing)
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
  // STEP 11) Search-as-you-type (debounced)
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
  // STEP 12) Submit search
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
  // STEP 13) Suggestion click (optional; list is currently empty)
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
  // STEP 14) Kick off initial load
  // =========================================================
  initialLoad();
});
