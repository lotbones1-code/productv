document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-auto-submit]').forEach((el) => {
    el.addEventListener('change', () => {
      if (el.form) el.form.submit();
    });
  });

  document.querySelectorAll('.js-utc-time').forEach((el) => {
    const iso = el.dataset.utc;
    if (!iso) return;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      el.textContent = date.toLocaleString();
    }
  });

  const addLinkBtn = document.querySelector('[data-add-link]');
  const linksContainer = document.querySelector('[data-links-container]');
  if (addLinkBtn && linksContainer) {
    addLinkBtn.addEventListener('click', (event) => {
      event.preventDefault();
      const input = document.createElement('input');
      input.type = 'url';
      input.name = 'links';
      input.placeholder = 'https://...';
      input.className = 'mt-2 block w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500';
      linksContainer.appendChild(input);
      input.focus();
    });
  }
});
