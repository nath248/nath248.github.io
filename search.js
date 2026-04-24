document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');
  const RESULTS_CONTAINER_SELECTOR = '.product_list';

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

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function runDySemanticSearch(query) {
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
        isImplicitPageview: true
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
      cache: 'no-store'
    });

    if (!response.ok) throw new Error('DY Semantic Search request failed');
    return response.json();
  }

  function getContainer() {
    return document.querySelector(RESULTS_CONTAINER_SELECTOR);
  }

  function renderProducts(items) {
    const container = getContainer();
    if (!container) return;
    container.innerHTML = '';

    (items || []).forEach(item => {
      const card = document.createElement('div');
      card.className = 'product_card';
      const name = escapeHtml(item?.name || '');
      const price = item?.price != null ? `<p>$${escapeHtml(String(item.price))}</p>` : '';
      card.innerHTML = `<h3>${name}</h3>${price}`;
      container.appendChild(card);
    });
  }

  function showSuggestions(items) {
    if (!items.length) {
      suggestions.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    suggestions.innerHTML = items.map((t, i) =>
      `<li role="option" id="sug-${i}" data-value="${String(t).replace(/"/g, '&quot;')}">${escapeHtml(String(t))}</li>`
    ).join('');
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

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

  let activeRequestToken = 0;

  async function submitSearch(query) {
    if (!query) return;

    const requestToken = ++activeRequestToken;
    status.textContent = 'Searching…';

    try {
      const dyResponse = await runDySemanticSearch(query);
      if (requestToken !== activeRequestToken) return;

      const items = extractItemsFromDyResponse(dyResponse);
      renderProducts(items);
      status.textContent = `${items.length} result(s) for "${query}".`;
    } catch (err) {
      console.error(err);
      if (requestToken !== activeRequestToken) return;
      status.textContent = 'Search failed. Please try again.';
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    submitSearch(input.value.trim());
  });

  suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;
    input.value = li.dataset.value;
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    submitSearch(input.value.trim());
  });

  let debounceTimer = null;

  input.addEventListener('input', () => {
    const q = input.value.trim();

    if (!q) {
      activeRequestToken++;
      renderProducts([]);
      status.textContent = '';
      suggestions.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => submitSearch(q), 250);
  });
});
