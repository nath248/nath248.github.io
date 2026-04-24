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
  const TYPE_DEBOUNCE_MS = 300;
  const MIN_QUERY_LEN = 1;

  const DEFAULT_INITIAL_QUERY = 'shirt';  // initial query shown when landing
  const PAGE_SIZE = 12;
  const PAGE_OFFSET = 0;

  // =========================================================
  // STEP 3) Cookie helpers (explicitly read from document.cookie)
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

  function getDyIdentifiers() {
    // Explicitly read the cookie names you confirmed exist:
    const dyid = getCookie('_dyid');
    const dyjsession = getCookie('_dyjsession');

    // Console log values at fetch time (so you can verify)
    console.log('[DY Cookies fetched]', { dyid, dyjsession });

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
  // STEP 5) Extract products from DY response (CORRECT PATH)
  // Based on your screenshot:
  // choices[0].variations[0].payload.data.slots  (Array of slots)
  // Each slot: { sku, productData, slotId }
  // =========================================================
  function extractSlotsFromDyResponse(dyResponse) {
    const slots = dyResponse?.choices?.[0]?.variations?.[0]?.payload?.data?.slots;
    return Array.isArray(slots) ? slots : [];
  }

  // =========================================================
  // STEP 6) Render products (slots -> slot.productData)
  // =========================================================
  function renderProducts(slots) {
    resultsContainer.innerHTML = '';

    slots.forEach((slot) => {
      const product = slot?.productData || {};

      // Common fields; your feed may use different keys.
      // We keep fallbacks so something renders even if the field name differs.
      const sku = slot?.sku ?? product?.sku ?? '';
      const name =
        product?.name ??
        product?.title ??
        product?.productName ??
        product?.product_name ??
        sku;

      const price =
        product?.price ??
        product?.itemPrice ??
        product?.salePrice ??
        product?.price_value ??
        null;

      const url =
        product?.url ??
        product?.productUrl ??
        product?.product_url ??
        '#';

      const image =
        product?.image_url ??
        product?.imageUrl ??
        product?.image ??
        product?.img ??
        '';

      const meta =
        product?.category ??
        product?.categories ??
        product?.brand ??
        '';

      const card = document.createElement('div');
      card.className = 'product_card';

      // Store identifiers on the DOM for later debugging / engagement work
      if (sku) card.dataset.sku = sku;
      if (slot?.slotId) card.dataset.slotId = slot.slotId;

      card.innerHTML = `
        ${escapeHtml(url)}
          ${image ? `${escapeHtml(image)}" loading="lazy">` : ''}
          <h3 class="product_title">${escapeHtml(name)}</h3>
        </a>
        ${meta ? `<p class="product_meta">${escapeHtml(String(meta))}</p>` : ''}
        ${price != null ? `<p class="product_price">$${escapeHtml(String(price))}</p>` : ''}
      `;

      resultsContainer.appendChild(card);
    });
  }

  // =========================================================
  // STEP 7) Build payload in EXACT format you requested
  // user.dyid populated from _dyid cookie
  // session.dy populated from _dyjsession cookie
  // dyid_server excluded
  // =========================================================
  function buildPayload(queryText) {
    const { dyid, dyjsession } = getDyIdentifiers();

    // You said these need to be defined in the payload.
    // We populate from cookies; if missing, we still define keys (empty string)
    // and log a warning so you can see why.
    if (!dyid || !dyjsession) {
      console.warn('[DY Cookies] Missing cookie values. Payload will include empty strings.', { dyid, dyjsession });
    }

    const payload = {
      user: { dyid: dyid ? String(dyid) : '' },
      session: { dy: dyjsession ? String(dyjsession) : '' },
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
        returnAnalyticsMetadata: false
      },
      query: {
        text: String(queryText),
        pagination: { numItems: PAGE_SIZE, offset: PAGE_OFFSET }
      }
    };

    console.log('[DY Payload built]', payload);
    return payload;
  }

  // =========================================================
  // STEP 8) Run DY Search API (AbortController cancels old calls while typing)
  // =========================================================
  let activeController = null;

  async function runDySemanticSearch(queryText, logLabel) {
    if (activeController) activeController.abort();
    activeController = new AbortController();

    const payload = buildPayload(queryText);

    console.groupCollapsed(`[DY Search] ${logLabel}`);
    console.log('Final request payload:', payload);
    console.groupEnd();

    const res = await fetch('https://direct.dy-api.com/v2/serve/user/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DY-API-Key': '115d8bef0694cd3d125fb38e0ee5cba9f241403914493b144e36ddf885a4dbb9'
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

    const slots = extractSlotsFromDyResponse(json);
    console.log('Extracted slots count:', slots.length);
    console.log('Extracted slots sample (first 3):', slots.slice(0, 3));
    console.groupEnd();

    return json;
  }

  // =========================================================
  // STEP 9) Execute search + render
  // =========================================================
  async function doSearch(query, labelOverride) {
    const q = String(query).trim();

    if (q.length < MIN_QUERY_LEN) {
      return { ok: true, slots: [], query: q };
    }

    status.textContent = 'Searching…';

    try {
      const dyResponse = await runDySemanticSearch(q, labelOverride ?? `Query="${q}"`);
      const slots = extractSlotsFromDyResponse(dyResponse);

      renderProducts(slots);
      status.textContent = `${slots.length} result(s) for "${q}".`;

      return { ok: true, slots, query: q };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, aborted: true, slots: [], query: q };
      console.error('[DY Search] Search error:', err);
      status.textContent = 'Search failed. Please try again.';
      return { ok: false, slots: [], query: q };
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
      const slots = extractSlotsFromDyResponse(dyResponse);

      renderProducts(slots);
      status.textContent = `${slots.length} product(s) loaded.`;
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
