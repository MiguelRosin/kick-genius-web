// Reordena las tarjetas de producto del grid de catalogo.html.
// Regla (confirmada por el usuario):
//   - Solo se reordena DENTRO de cada equipo: cada equipo conserva los
//     "huecos" que ocupa ahora en el grid; solo cambia el orden de sus
//     variantes entre sí. Funciona igual si esos huecos están dispersos
//     por el grid (p.ej. tras añadir una tarjeta nueva al final).
//   - Categorías afectadas: futbol (Camisetas), nino (Equipaciones Niño)
//     y retro (Camisetas Retro).
//   - Orden de variantes: local, visitante, alternativa, cuarta,
//     portero local, portero visitante, player local, player visitante,
//     player alternativa, girl local, girl visitante, girl alternativa.
//   - En retro, primero por temporada (más antigua primero) y dentro de
//     cada temporada por ese mismo orden de variantes.
//
// Se usa como módulo (sortProductGrid) desde scripts/add-products.js para
// que las camisetas nuevas queden ya bien ordenadas al insertarlas, y
// también como CLI para reordenar el catálogo entero a mano:
//   node scripts/sort-products.js [--write]
// Sin --write hace una simulación y muestra el resumen.

const CATS = new Set(['futbol', 'nino', 'retro']);

function normYY(yy) {
  return yy >= 40 ? 1900 + yy : 2000 + yy;
}

// Devuelve el año de temporada de un id retro, o 9999 si no se puede leer.
function seasonYear(id) {
  const all = id.match(/\d{4}/g);
  if (!all) return 9999;
  const tok = all[all.length - 1];
  const d1 = +tok.slice(0, 2);
  const d2 = +tok.slice(2);
  if ((d1 + 1) % 100 === d2) return normYY(d1);          // par de años consecutivos: 9495, 2021
  if ((d1 === 19 || d1 === 20)) return +tok;             // año real: 1995, 2002
  return normYY(d1);                                     // rango: 8591, 9295
}

// Rango de la variante (0..11) a partir del id (con el equipo ya quitado).
function kitRank(idTail) {
  const t = idTail.split('-');
  const has = w => t.includes(w);
  const girl = has('girl');
  const player = has('player');
  const gk = has('gk') || has('portero');
  const away = has('away') || has('visitante');
  const alt = has('alt') || has('alternativa') || has('tercera') || has('third');
  const cuarta = has('cuarta') || has('fourth');

  if (girl) return alt ? 11 : away ? 10 : 9;
  if (player) return alt ? 8 : away ? 7 : 6;
  if (gk) return away ? 5 : 4;
  if (cuarta) return 3;
  if (alt) return 2;
  if (away) return 1;
  return 0;
}

const RANK_LABEL = [
  'local', 'visitante', 'alternativa', 'cuarta',
  'portero local', 'portero visitante',
  'player local', 'player visitante', 'player alternativa',
  'girl local', 'girl visitante', 'girl alternativa'
];

// Reordena el grid de producto dentro de `html` (string completo de
// catalogo.html) y devuelve { html, blocksTotal, groupsCount, changes,
// noSeason }. No escribe nada a disco. Lanza si algo no cuadra, sin tocar
// el html de entrada.
function sortProductGrid(html) {
  html = html.replace(/\r\n/g, '\n');

  const gridOpen = html.indexOf('<div class="product-grid" id="productGrid">');
  if (gridOpen === -1) throw new Error('No se encontró el grid de productos.');
  const anchor = '\n    </div>\n\n    <p class="empty-state" id="emptyState">';
  const gridEnd = html.indexOf(anchor, gridOpen);
  if (gridEnd === -1) throw new Error('No se encontró el final del grid.');

  const contentStart = html.indexOf('\n', gridOpen) + 1; // tras la línea de apertura
  const prefix = html.slice(0, contentStart);
  const region = html.slice(contentStart, gridEnd);
  const suffix = html.slice(gridEnd);

  const cardRe = /      <!-- PRODUCTO REAL -->\n      <article class="product-card"[\s\S]*?\n      <\/article>\n/g;
  const blocks = region.match(cardRe) || [];
  if (!blocks.length) throw new Error('No se encontraron tarjetas de producto.');

  // Comprobación de ida y vuelta: el grid debe ser exactamente
  // (texto entre tarjetas) + tarjetas, sin perder nada.
  const seps = [];
  let cursor = 0;
  for (const b of blocks) {
    const at = region.indexOf(b, cursor);
    seps.push(region.slice(cursor, at));
    cursor = at + b.length;
  }
  const tailSep = region.slice(cursor);
  const rebuilt = seps.map((s, i) => s + blocks[i]).join('') + tailSep;
  if (rebuilt !== region) throw new Error('La comprobación de ida y vuelta falló al reordenar; abortado sin tocar nada.');

  const attr = (b, name) => (b.match(new RegExp(name + '="([^"]*)"')) || [])[1] || '';
  const meta = blocks.map((b, i) => {
    const id = attr(b, 'data-id');
    if (!id) throw new Error('Tarjeta sin data-id en el índice ' + i);
    return { i, cat: attr(b, 'data-cat'), league: attr(b, 'data-league'), team: attr(b, 'data-team'), id };
  });

  // Agrupa por (cat, league, team) solo en las categorías afectadas.
  const groups = new Map();
  for (const c of meta) {
    if (!CATS.has(c.cat)) continue;
    const key = `${c.cat}|${c.league}|${c.team}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const order = blocks.map((_, i) => i); // permutación destino: order[slot] = índiceBloqueOriginal
  const changes = [];
  const noSeason = [];

  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const [cat, , team] = key.split('|');
    const slots = members.map(m => m.i).slice().sort((a, b) => a - b);

    const sorted = members.slice().sort((a, b) => {
      const tailA = a.id.startsWith(team + '-') ? a.id.slice(team.length + 1) : a.id;
      const tailB = b.id.startsWith(team + '-') ? b.id.slice(team.length + 1) : b.id;
      const yA = cat === 'retro' ? seasonYear(a.id) : 0;
      const yB = cat === 'retro' ? seasonYear(b.id) : 0;
      if (yA !== yB) return yA - yB;
      const rA = kitRank(tailA);
      const rB = kitRank(tailB);
      if (rA !== rB) return rA - rB;
      return a.i - b.i; // estable
    });

    if (cat === 'retro') {
      for (const m of members) if (seasonYear(m.id) === 9999) noSeason.push(m.id);
    }

    let moved = false;
    slots.forEach((slot, j) => {
      order[slot] = sorted[j].i;
      if (sorted[j].i !== members.find(x => x.i === slot).i) moved = true;
    });
    if (moved) {
      changes.push({
        key,
        before: slots.map(s => meta[s].id),
        after: sorted.map(s => s.id + '  [' + RANK_LABEL[kitRank(s.id.startsWith(team + '-') ? s.id.slice(team.length + 1) : s.id)] + (cat === 'retro' ? ', ' + seasonYear(s.id) : '') + ']')
      });
    }
  }

  const newBlocks = order.map(idx => blocks[idx]);
  const newRegion = seps.map((s, i) => s + newBlocks[i]).join('') + tailSep;
  const newHtml = prefix + newRegion + suffix;

  // Validaciones de seguridad.
  if (newBlocks.length !== blocks.length) throw new Error('Cambió el número de tarjetas al reordenar.');
  const idsBefore = meta.map(m => m.id).slice().sort();
  const idsAfter = newBlocks.map(b => (b.match(/data-id="([^"]*)"/) || [])[1]).sort();
  if (JSON.stringify(idsBefore) !== JSON.stringify(idsAfter)) throw new Error('Se perdió o duplicó algún data-id al reordenar.');
  if (newHtml.length !== html.length) throw new Error('El tamaño del archivo cambió al reordenar (no debería): ' + (newHtml.length - html.length));

  return { html: newHtml, blocksTotal: blocks.length, groupsCount: groups.size, changes, noSeason: [...new Set(noSeason)] };
}

function runCli() {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.resolve(__dirname, '..');
  const CATALOGO = path.join(ROOT, 'catalogo.html');
  const BACKUP_DIR = path.join(__dirname, '.backups');
  const WRITE = process.argv.includes('--write');

  const html = fs.readFileSync(CATALOGO, 'utf8');
  const result = sortProductGrid(html);

  console.log(`Tarjetas totales: ${result.blocksTotal}`);
  console.log(`Grupos equipo/categoría afectados: ${result.groupsCount}`);
  console.log(`Grupos con cambios de orden: ${result.changes.length}`);
  if (result.noSeason.length) {
    console.log(`\nRetro sin temporada legible (se colocan al final de su bloque): ${result.noSeason.join(', ')}`);
  }
  console.log('\n--- Cambios (primeros 40) ---');
  for (const c of result.changes.slice(0, 40)) {
    console.log(`\n[${c.key}]`);
    console.log('  antes:  ' + c.before.join(', '));
    console.log('  ahora:  ' + c.after.join(' | '));
  }

  if (!WRITE) {
    console.log('\n(simulación; ejecuta con --write para guardar)');
    return;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backup = path.join(BACKUP_DIR, `catalogo.sort.${Date.now()}.html`);
  fs.writeFileSync(backup, html, 'utf8');
  fs.writeFileSync(CATALOGO, result.html, 'utf8');
  console.log(`\n✔ Guardado. Copia de seguridad: ${path.relative(ROOT, backup)}`);
}

module.exports = { sortProductGrid, kitRank, seasonYear };

if (require.main === module) runCli();
