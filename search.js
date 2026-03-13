
  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchInput');
  const status = document.getElementById('searchStatus');
  const suggestions = document.getElementById('searchSuggestions');

  function getProductCards() {
    return Array.from(document.querySelectorAll('.product_list .product_card'));
  }

  function filterProducts(query) {
    const q = query.trim().toLowerCase();
    const cards = getProductCards();

    let shown = 0;
    cards.forEach(card => {
      const name = (card.getAttribute('data-name') || card.textContent || '').toLowerCase();
      const match = !q || name.includes(q);
      card.style.display = match ? '' : 'none';
      if (match) shown++;
    });

    status.textContent = q ? `${shown} result(s) for “${query}”.` : '';
  }

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

  // Very simple suggestions based on product_card data-name
  function buildSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const names = getProductCards()
      .map(c => c.getAttribute('data-name'))
      .filter(Boolean);

    const unique = Array.from(new Set(names));
    return unique
      .filter(n => n.toLowerCase().includes(q))
      .slice(0, 6);
  }

  input.addEventListener('input', () => {
    const s = buildSuggestions(input.value);
    showSuggestions(s);
    filterProducts(input.value);
  });

  suggestions.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;
    input.value = li.dataset.value;
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    filterProducts(input.value);
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    suggestions.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    filterProducts(input.value);
  });
