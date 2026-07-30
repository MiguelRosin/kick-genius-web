// Controla si el enlace "Stock" del menú se muestra en las 9 páginas.
// Cuando añadas productos reales a stock.html, cambia esta línea a "true".
window.KICK_HAS_STOCK = false;
if (!window.KICK_HAS_STOCK) document.documentElement.setAttribute('data-stock', 'hidden');
