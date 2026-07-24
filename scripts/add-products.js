// Sube varios productos a la vez a catalogo.html: entrada en el árbol de
// categorías (si el equipo/modelo es nuevo), tarjeta del grid y objeto
// PRODUCTS. Lee un JSON con la lista de productos (ver products-queue.example.json).
//
// Uso:
//   node scripts/add-products.js [ruta-a-cola.json]
// Por defecto usa scripts/products-queue.json

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOGO_PATH = path.join(ROOT, 'catalogo.html');
const queuePath = path.resolve(process.argv[2] || path.join(__dirname, 'products-queue.json'));
const BACKUP_DIR = path.join(__dirname, '.backups');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* opcional */ }

const INDENT = {
  cat: '            ',      // 12
  sub: '              ',    // 14
  subInner: '                ', // 16
  subsub: '                ',   // 16
  subsubInner: '                  ' // 18
};

function lineStart(html, idx) {
  return html.lastIndexOf('\n', idx - 1) + 1;
}

function esCompare(a, b) {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

function fail(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

function readQueue() {
  if (!fs.existsSync(queuePath)) {
    fail(`No se encuentra el archivo de cola: ${queuePath}`);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  } catch (e) {
    fail(`El JSON de la cola no es válido: ${e.message}`);
  }
  if (!Array.isArray(data)) fail('El JSON de la cola debe ser un array de productos.');
  return data;
}

// Encuentra el cierre </div> que corresponde al <div ...> que empieza en openStart,
// contando aperturas/cierres anidados.
function findMatchingDivClose(html, openStart) {
  const openTagEnd = html.indexOf('>', openStart) + 1;
  let depth = 1;
  const re = /<div[\s>]|<\/div>/g;
  re.lastIndex = openTagEnd;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<div')) depth++;
    else depth--;
    if (depth === 0) {
      return { contentStart: openTagEnd, contentEnd: m.index, closeTagStart: m.index, closeTagEnd: m.index + m[0].length };
    }
  }
  throw new Error('No se encontró el cierre del <div> (HTML desbalanceado).');
}

// Localiza el bloque <div class="tree-children"> que sigue inmediatamente a un botón dado.
function childrenBlockAfter(html, buttonMatchIndex) {
  const divOpen = html.indexOf('<div class="tree-children">', buttonMatchIndex);
  if (divOpen === -1) throw new Error('No se encontró tree-children tras el botón.');
  return findMatchingDivClose(html, divOpen);
}

function buildSubsubButton(level, dataAttrs, label, text) {
  return `${INDENT.subsub}<button class="tree-item tree-subsub" ${dataAttrs} data-label="${label}">\n` +
         `${INDENT.subsubInner}${text}\n` +
         `${INDENT.subsub}</button>\n`;
}

function buildSubButton(dataAttrs, label, text, subsubHtml) {
  return `${INDENT.sub}<button class="tree-item tree-sub" ${dataAttrs} data-label="${label}">\n` +
         `${INDENT.subInner}<span>${text}</span><span class="tree-toggle">+</span>\n` +
         `${INDENT.sub}</button>\n` +
         `${INDENT.sub}<div class="tree-children">\n` +
         subsubHtml +
         `${INDENT.sub}</div>\n`;
}

// Inserta (si hace falta) la entrada de árbol para un producto de fútbol o sneaker.
// Devuelve el html actualizado.
function ensureTreeEntry(html, p) {
  const isFutbol = p.type !== 'sneaker';
  const catSelector = isFutbol ? 'futbol' : 'sneakers';
  const catLabel = isFutbol ? 'Categoría: Fútbol' : 'Categoría: Sneakers';

  const catBtnRe = new RegExp(`<button class="tree-item tree-cat" data-cat="${catSelector}" data-label="${catLabel}">`);
  const catBtnMatch = catBtnRe.exec(html);
  if (!catBtnMatch) throw new Error(`No se encontró la categoría raíz "${catSelector}" en el árbol.`);
  const catBlock = childrenBlockAfter(html, catBtnMatch.index);

  const subKey = isFutbol ? p.league : p.brand;
  const subLabel = isFutbol ? p.leagueLabel : p.brandLabel;
  const leafKey = isFutbol ? p.team : p.model;
  const leafLabel = isFutbol ? p.teamLabel : p.modelLabel;
  const subAttr = isFutbol ? 'data-league' : 'data-brand';
  const leafAttr = isFutbol ? 'data-team' : 'data-model';

  const section = html.slice(catBlock.contentStart, catBlock.contentEnd);
  const subBtnRe = new RegExp(`<button class="tree-item tree-sub" data-cat="${catSelector}" ${subAttr}="${subKey}" data-label="[^"]*">`);
  const subBtnMatchLocal = subBtnRe.exec(section);

  const leafDataAttrs = isFutbol
    ? `data-cat="futbol" data-league="${subKey}" data-team="${leafKey}"`
    : `data-cat="sneakers" data-brand="${subKey}" data-model="${leafKey}"`;
  const leafFullLabel = isFutbol
    ? `Categoría: Fútbol · ${subLabel} · ${leafLabel}`
    : `Categoría: Sneakers · ${subLabel} · ${leafLabel}`;

  if (!subBtnMatchLocal) {
    // Liga/marca nueva: se añade un bloque nuevo al final de la categoría.
    const subFullLabel = isFutbol ? `Categoría: Fútbol · ${subLabel}` : `Categoría: Sneakers · ${subLabel}`;
    const subDataAttrs = isFutbol
      ? `data-cat="futbol" ${subAttr}="${subKey}"`
      : `data-cat="sneakers" ${subAttr}="${subKey}"`;
    const subsubHtml = buildSubsubButton(2, leafDataAttrs, leafFullLabel, leafLabel);
    const newBlock = buildSubButton(subDataAttrs, subFullLabel, subLabel, subsubHtml);
    const insertAt = lineStart(html, catBlock.closeTagStart);
    console.log(`  + Nueva ${isFutbol ? 'liga' : 'marca'} en el árbol: ${subLabel}`);
    return html.slice(0, insertAt) + newBlock + html.slice(insertAt);
  }

  // Liga/marca existente: comprobar si el equipo/modelo ya está.
  const subBtnAbsIndex = catBlock.contentStart + subBtnMatchLocal.index;
  const leafBlock = childrenBlockAfter(html, subBtnAbsIndex);
  const leafSection = html.slice(leafBlock.contentStart, leafBlock.contentEnd);

  const existingLeafRe = new RegExp(`${leafAttr}="${leafKey}"`);
  if (existingLeafRe.test(leafSection)) {
    return html; // ya existe, nada que hacer
  }

  // Insertar alfabéticamente (colación española) entre los hermanos existentes.
  const itemRe = /[ \t]*<button class="tree-item tree-subsub"[^>]*>\s*\n\s*([^\n]+?)\s*\n\s*<\/button>\n/g;
  let m;
  let insertOffset = lineStart(html, leafBlock.contentEnd); // por defecto, al final
  while ((m = itemRe.exec(leafSection))) {
    const existingLabel = m[1].trim();
    if (esCompare(leafLabel, existingLabel) < 0) {
      insertOffset = leafBlock.contentStart + m.index;
      break;
    }
  }
  const newSubsub = buildSubsubButton(2, leafDataAttrs, leafFullLabel, leafLabel);
  console.log(`  + Nuevo ${isFutbol ? 'equipo' : 'modelo'} en el árbol: ${leafLabel} (${subLabel})`);
  return html.slice(0, insertOffset) + newSubsub + html.slice(insertOffset);
}

function buildCardHtml(p) {
  const catAttr = p.type === 'sneaker'
    ? `data-cat="sneakers" data-brand="${p.brand}" data-model="${p.model}"`
    : `data-cat="futbol" data-league="${p.league}" data-team="${p.team}"`;
  const catLabel = p.type === 'sneaker'
    ? `Sneakers · ${p.brandLabel} · ${p.modelLabel}`
    : `Fútbol · ${p.leagueLabel} · ${p.teamLabel}`;

  const badge = p.badge || `-${Math.round((1 - p.price / p.originalPrice) * 100)}%`;
  const save = +(p.originalPrice - p.price).toFixed(2);
  const saveText = p.saveText || defaultSaveText(p, save);

  const imgTags = p.images.map((file, i) => {
    const cls = i === 0 ? 'img-a' : 'img-b';
    const side = i === 0 ? 'frontal' : 'trasera';
    return `          <img class="${cls}" loading="lazy" src="assets/productos/${p.id}/${file}" alt="${p.name} ${side}">`;
  }).join('\n');

  return `      <!-- PRODUCTO REAL -->\n` +
    `      <article class="product-card" ${catAttr} data-id="${p.id}">\n` +
    `        <div class="product-media">\n` +
    `          <span class="badge-offer">${badge}</span>\n` +
    imgTags + '\n' +
    `        </div>\n` +
    `        <div class="product-info">\n` +
    `          <span class="product-cat">${catLabel}</span>\n` +
    `          <span class="product-name">${p.name}</span>\n` +
    `          <div class="price-row">\n` +
    `            <span class="price-original">${p.originalPrice}€</span>\n` +
    `            <span class="price-final">${p.price}€</span>\n` +
    `            <span class="price-save">Ahorras ${save}€ · ${saveText}</span>\n` +
    `          </div>\n` +
    `        </div>\n` +
    `      </article>\n\n`;
}

function defaultSaveText(p, save) {
  const c = p.customization;
  if (!c) return p.type === 'sneaker' ? 'oferta por tiempo limitado' : 'sin personalización';
  if (c.socksFee) return 'incluye pantalón · personalizable';
  if (c.noPatch && c.noName) return 'personalizable';
  if (c.noPatch) return 'personalizable con nombre y número';
  return 'personalizable con nombre, número y parche';
}

function jsStringLiteral(v) {
  return `'${String(v).replace(/'/g, "\\'")}'`;
}

function buildProductEntry(p) {
  const catLabel = p.type === 'sneaker'
    ? `Sneakers · ${p.brandLabel} · ${p.modelLabel}`
    : `Fútbol · ${p.leagueLabel} · ${p.teamLabel}`;

  const sizesJs = '[' + p.sizes.map(s => (typeof s === 'number' ? s : jsStringLiteral(s))).join(',') + ']';
  const imagesJs = p.images.map(f => `        'assets/productos/${p.id}/${f}'`).join(',\n');

  let customJs = '';
  if (p.customization) {
    const lines = Object.entries(p.customization).map(([k, v]) => {
      const val = typeof v === 'string' ? jsStringLiteral(v) : v;
      return `        ${k}: ${val}`;
    });
    customJs = `,\n      customization: {\n${lines.join(',\n')}\n      }`;
  }

  const noteJs = p.note ? `,\n      note: ${jsStringLiteral(p.note)}` : '';

  return `    ${jsStringLiteral(p.id)}: {\n` +
    `      name: ${jsStringLiteral(p.name)},\n` +
    `      cat: ${jsStringLiteral(catLabel)},\n` +
    `      price: ${p.price},\n` +
    `      originalPrice: ${p.originalPrice},\n` +
    `      sizes: ${sizesJs}${noteJs},\n` +
    `      images: [\n${imagesJs}\n      ]${customJs}\n` +
    `    }`;
}

function validateProduct(p, errors) {
  const required = ['id', 'name', 'price', 'originalPrice', 'sizes', 'images'];
  for (const f of required) {
    if (p[f] === undefined || p[f] === null) errors.push(`falta el campo "${f}"`);
  }
  if (p.type === 'sneaker') {
    for (const f of ['brand', 'brandLabel', 'model', 'modelLabel']) {
      if (!p[f]) errors.push(`falta el campo "${f}" (producto tipo sneaker)`);
    }
  } else {
    for (const f of ['league', 'leagueLabel', 'team', 'teamLabel']) {
      if (!p[f]) errors.push(`falta el campo "${f}" (producto de fútbol)`);
    }
  }
  if (!/^[a-z0-9-]+$/.test(p.id || '')) errors.push('el id debe ser minúsculas/números/guiones, ej. "liverpool-away-9900"');
  return errors;
}

async function compressImages(p) {
  const dir = path.join(ROOT, 'assets', 'productos', p.id);
  if (!fs.existsSync(dir)) {
    return { ok: false, error: `no existe la carpeta assets/productos/${p.id}/` };
  }
  for (const file of p.images) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      return { ok: false, error: `falta la imagen ${file} en assets/productos/${p.id}/` };
    }
  }
  if (!sharp) return { ok: true, compressed: false };

  for (const file of p.images) {
    if (!/\.jpe?g$/i.test(file)) continue;
    const full = path.join(dir, file);
    const tmp = full + '.tmp';
    const img = sharp(full).rotate();
    const meta = await img.metadata();
    let pipeline = img;
    if (meta.width && meta.width > 1200) pipeline = pipeline.resize({ width: 1200 });
    await pipeline.jpeg({ quality: 80, mozjpeg: true }).toFile(tmp);
    fs.renameSync(tmp, full);
  }
  return { ok: true, compressed: true };
}

async function main() {
  const queue = readQueue();
  if (queue.length === 0) fail('La cola está vacía.');

  let html = fs.readFileSync(CATALOGO_PATH, 'utf8');

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `catalogo.${Date.now()}.html`);
  fs.writeFileSync(backupPath, html, 'utf8');

  const added = [];
  const skipped = [];

  for (const p of queue) {
    const errors = validateProduct(p, []);
    if (errors.length) {
      skipped.push(`${p.id || '(sin id)'}: ${errors.join('; ')}`);
      continue;
    }
    const existsRe = new RegExp(`['"]${p.id}['"]\\s*:\\s*{`);
    if (existsRe.test(html)) {
      skipped.push(`${p.id}: ya existe en PRODUCTS, se omite`);
      continue;
    }

    const imgResult = await compressImages(p);
    if (!imgResult.ok) {
      skipped.push(`${p.id}: ${imgResult.error}`);
      continue;
    }

    console.log(`→ Añadiendo ${p.id}...`);
    html = ensureTreeEntry(html, p);

    const cardAnchor = '\n    </div>\n\n    <p class="empty-state" id="emptyState">';
    if (!html.includes(cardAnchor)) throw new Error('No se encontró el punto de inserción del grid de productos.');
    html = html.replace(cardAnchor, '\n' + buildCardHtml(p) + cardAnchor.slice(1));

    const dataAnchor = '\n  };\n\n  // ===== Ficha de producto (modal) =====';
    if (!html.includes(dataAnchor)) throw new Error('No se encontró el punto de inserción de PRODUCTS.');
    html = html.replace(dataAnchor, ',\n' + buildProductEntry(p) + dataAnchor);

    added.push(p.id);
  }

  if (added.length === 0) {
    console.log('\nNada que añadir.');
    if (skipped.length) console.log('Omitidos:\n' + skipped.map(s => '  - ' + s).join('\n'));
    fs.unlinkSync(backupPath);
    return;
  }

  fs.writeFileSync(CATALOGO_PATH, html, 'utf8');

  // Verificación de sintaxis del <script> principal
  const scriptMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const big = scriptMatches.reduce((a, b) => (a[1].length > b[1].length ? a : b));
  const checkFile = path.join(BACKUP_DIR, '_check.js');
  fs.writeFileSync(checkFile, big[1], 'utf8');

  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, ['--check', checkFile], { stdio: 'pipe' });
  } catch (e) {
    fs.writeFileSync(CATALOGO_PATH, fs.readFileSync(backupPath, 'utf8'), 'utf8');
    fs.unlinkSync(checkFile);
    fail(`Error de sintaxis tras la inserción, se ha restaurado catalogo.html.\n${e.stderr ? e.stderr.toString() : e.message}`);
  }
  fs.unlinkSync(checkFile);

  console.log(`\n✔ Añadidos ${added.length} producto(s): ${added.join(', ')}`);
  if (skipped.length) console.log('Omitidos:\n' + skipped.map(s => '  - ' + s).join('\n'));
  if (!sharp) console.log('\n(sharp no está instalado en scripts/node_modules — las imágenes no se han comprimido automáticamente; ejecuta "npm install" dentro de scripts/ para activarlo)');
  console.log(`\nCopia de seguridad guardada en: ${path.relative(ROOT, backupPath)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
