document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');

  /* ---------------- Cookie helpers ---------------- */

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

  /* ---------------- DY Semantic Search ---------------- */

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
        }
      },
      options: {
        isImplicitClientData: false,
        returnAnalyticsMetadata: false
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
        'DY-API-Key': ${{ secrets.DY_API_KEY }}
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error('DY Semantic Search request failed');
    }

    return response.json();
  }

  /* ---------------- Rendering ---------------- */

  function renderProducts(items) {
    const container = document.querySelector('.product_list');
    container.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'product_card';
      card.innerHTML = `
        <h3>${item.name || ''}</h3>
        ${item.price ? `<p>$${item.price}</p>` : ''}
      `;
      container.appendChild(card);
    });
  }

  /* ---------------- Suggestions (unchanged logic) ---------------- */

  function showSuggestions(items) {
    if (!items.length) {
      suggestions.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    suggestions.innerHTML = items.map((t, i) =>
      `<li role="option" id="sug-${i}" data-value="${t.replace(/"/g, '&quot;')}">${t}</li>`
    ).join('');
    suggestions.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  /* ---------------- Submit handler ---------------- */

  async function submitSearch(query) {
    if (!query) return;

    status.textContent = 'Searching';

    try {
      const dyResponse = await runDySemanticSearch(query);

      const items = dyResponse.choices?.[0]?.variations?.[0]?.payload?.items || [];

      renderProducts(items);
      status.textContent = `${items.length} result(s) for C${query}D.`;
    } catch (err) {
      console.error(err);
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
});
