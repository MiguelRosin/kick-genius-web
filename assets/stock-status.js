// Interruptores de secciones del menú (se aplican a todas las páginas).
// Pon true para volver a mostrar la sección. Mientras estén en false, los enlaces
// se ocultan y netlify.toml redirige /stock.html y /seguimiento.html a la home.
window.KICK_HAS_STOCK = false;
window.KICK_HAS_TRACKING = false;
(function () {
  var hidden = [];
  if (!window.KICK_HAS_STOCK) {
    document.documentElement.setAttribute('data-stock', 'hidden');
    hidden.push('li:has(> a[href="stock.html"])', 'a[href="stock.html"]');
  }
  if (!window.KICK_HAS_TRACKING) {
    hidden.push('li:has(> a[href="seguimiento.html"])', 'a[href="seguimiento.html"]');
  }
  if (hidden.length) {
    var style = document.createElement('style');
    style.textContent = hidden.join(',') + '{display:none !important;}';
    document.head.appendChild(style);
  }
})();
