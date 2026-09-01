// Recalcula el total de un pedido desde el catálogo real del servidor, en vez de
// confiar en los precios que manda el navegador (que se pueden editar en
// localStorage). También valida el código de cupón sin exponer la lista completa
// al frontend. products-data.json se regenera automáticamente a partir de
// catalogo.html — ver scripts/build-products-data.js.

const products = require('./products-data.json');

const COUPONS = {
  PROMO: { type: 'fixed', value: 25, label: '25€ de descuento', minQty: 6 },
  PEDIDOENTREGADO: { type: 'percent', value: 5, label: '5% de descuento' },
  'GANADOR-AGOSTO26-7KQP': { type: 'percent', value: 100, maxDiscount: 25, label: 'Camiseta gratis (hasta 25€)' }
};

const MAX_QTY_PER_ITEM = 50;
const MAX_ITEMS = 100;

// Límite de peticiones por IP. Es en memoria (best-effort): se reinicia si la
// función arranca en frío y no se comparte entre instancias en paralelo, así
// que no es infalible — pero frena una ráfaga de un script desde una misma
// conexión, que es el abuso real que nos preocupa aquí.
const RATE_WINDOW_MS = 2 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;
const requestLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  // Limpieza ocasional para no acumular IPs viejas indefinidamente en memoria.
  if (requestLog.size > 5000) {
    for (const [key, times] of requestLog) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) requestLog.delete(key);
    }
  }
  return timestamps.length > RATE_MAX_REQUESTS;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const clientIp = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'])) || 'unknown';
  if (isRateLimited(clientIp)) {
    return {
      statusCode: 429,
      headers: { 'Retry-After': '120' },
      body: JSON.stringify({ error: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'El carrito está vacío' }) };
  }
  if (items.length > MAX_ITEMS) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Demasiados artículos en el carrito' }) };
  }

  const validatedItems = [];
  let subtotal = 0;
  let itemCount = 0;

  for (const raw of items) {
    const productId = typeof raw.productId === 'string' ? raw.productId : null;
    const product = productId ? products[productId] : null;
    if (!product) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'PRODUCT_NOT_FOUND', productId: productId || null })
      };
    }

    const qty = Math.max(1, Math.min(MAX_QTY_PER_ITEM, parseInt(raw.qty, 10) || 1));

    let unitPrice = product.price;
    const c = product.customization;
    const custom = raw.customization || null;
    if (c && custom) {
      if (custom.name || custom.number) unitPrice += c.nameNumberFee;
      if (custom.patch) unitPrice += c.patchFee;
      if (custom.socks) unitPrice += c.socksFee;
    }
    unitPrice = round2(unitPrice);

    subtotal += unitPrice * qty;
    itemCount += qty;
    validatedItems.push({ productId, unitPrice, qty });
  }
  subtotal = round2(subtotal);

  let discount = 0;
  let couponLabel = null;
  let couponValid = false;
  const code = typeof body.couponCode === 'string' ? body.couponCode.trim().toUpperCase() : '';
  if (code) {
    const coupon = COUPONS[code];
    if (coupon) {
      couponValid = true;
      couponLabel = coupon.label;
      if (!coupon.minQty || itemCount >= coupon.minQty) {
        let raw = coupon.type === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value;
        if (coupon.maxDiscount) raw = Math.min(raw, coupon.maxDiscount);
        discount = Math.min(round2(raw), subtotal);
      }
    }
  }

  const total = round2(subtotal - discount);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: validatedItems,
      itemCount,
      subtotal,
      discount,
      couponValid,
      couponLabel,
      total
    })
  };
};
