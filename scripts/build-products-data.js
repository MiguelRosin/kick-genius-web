// Extrae del PRODUCTS de catalogo.html solo lo necesario para validar precios en
// el servidor (netlify/functions/validate-order.js): precio base y reglas de
// personalización de cada producto. Se regenera automáticamente al final de
// add-products.js, así que no debería hacer falta ejecutarlo a mano salvo para
// reconstruir el archivo si se pierde.
//
// Uso: node scripts/build-products-data.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOGO_PATH = path.join(ROOT, 'catalogo.html');
const OUT_PATH = path.join(ROOT, 'netlify', 'functions', 'products-data.json');

function extractProducts() {
  const html = fs.readFileSync(CATALOGO_PATH, 'utf8').replace(/\r\n/g, '\n');
  const start = html.indexOf('const PRODUCTS = {');
  if (start === -1) throw new Error('No se encontró "const PRODUCTS = {" en catalogo.html');
  const anchor = '\n  };\n\n  // ===== Ficha de producto (modal) =====';
  const anchorIdx = html.indexOf(anchor, start);
  if (anchorIdx === -1) throw new Error('No se encontró el cierre de PRODUCTS en catalogo.html');
  const end = anchorIdx + '\n  };'.length;
  const src = html.slice(start, end);
  // El objeto es JS literal de confianza (nuestro propio código fuente), no input
  // externo, así que evaluarlo aquí es seguro.
  return new Function(`'use strict'; ${src} return PRODUCTS;`)();
}

function build() {
  const products = extractProducts();
  const out = {};
  for (const [id, p] of Object.entries(products)) {
    out[id] = {
      price: p.price,
      customization: p.customization
        ? {
            nameNumberFee: p.customization.nameNumberFee || 0,
            patchFee: p.customization.patchFee || 0,
            socksFee: p.customization.socksFee || 0
          }
        : null
    };
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8');
  return Object.keys(out).length;
}

if (require.main === module) {
  const count = build();
  console.log(`✔ netlify/functions/products-data.json generado con ${count} productos.`);
}

module.exports = { build };
