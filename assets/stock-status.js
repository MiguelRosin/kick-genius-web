// Controla si el enlace "Stock" del menú se muestra en las 9 páginas.
window.KICK_HAS_STOCK = true;
if (!window.KICK_HAS_STOCK) document.documentElement.setAttribute('data-stock', 'hidden');
