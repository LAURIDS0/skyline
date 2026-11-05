import { BUILDINGS, LEGACY_GRID, SITE_H, TILE_M, RUNWAY_EXTENSION_M, MAX_ITEMS, LEVELS } from './catalog.js';

const RUNWAY = { x: 6, y: 3, h: 5 };
export const EXT_W = RUNWAY_EXTENSION_M / TILE_M;

// Site plan in 10 m tiles. The main runway (real length, along the top) and the access road (bottom) are fixed.
export function site(type, runwayM) {
  const tiles = Math.ceil(runwayM / TILE_M);
  const w = Math.max(RUNWAY.x + tiles + BUILDINGS.runway_ext.max * EXT_W + 6, LEGACY_GRID[type].w * 8 + 8);
  const h = SITE_H[type];
  return { w, h, runway: { x: RUNWAY.x, y: RUNWAY.y, w: tiles, h: RUNWAY.h }, road: { x: 0, y: h - 3, w, h: 3 } };
}

// Items: { t, x, y, z?, r? }. Objects/ground tiles cover a footprint; edge items (walls, doors) sit on a tile edge:
// r = 0 → the horizontal edge on top of cell (x, y); r = 1 → the vertical edge left of cell (x, y).
export const layerOf = t => BUILDINGS[t].layer;
// Runways and airside pads are paving themselves, so they block both the ground and the object layer.
const layersOf = t => (layerOf(t) === 'ground' ? ['ground'] : BUILDINGS[t].access === 'air' || t === 'runway' || t === 'runway_ext' ? ['ground', 'object'] : ['object']);
export const footprint = p => {
  const b = BUILDINGS[p.t];
  return p.r % 2 ? { w: b.h, h: b.w } : { w: b.w, h: b.h };
};
export const cellKey = (s, z, layer, x, y) => (((z * 2 + (layer === 'ground' ? 0 : 1)) * s.h + y) * s.w) + x;
export const edgeKey = (z, r, x, y) => `${z}:${r & 1}:${x}:${y}`;

export function extSlot(s, layout) {
  const n = layout.filter(p => p.t === 'runway_ext').length;
  return n < BUILDINGS.runway_ext.max ? { x: s.runway.x + s.runway.w + n * EXT_W, y: s.runway.y } : null;
}

export const countTypes = layout => layout.reduce((c, p) => ((c[p.t] = (c[p.t] || 0) + 1), c), {});

// Occupancy: cell key → item index (−1 main runway, −2 access road); edge key → item index.
export function occupancy(s, layout) {
  const cells = new Map(), edges = new Map();
  const fill = (z, layer, x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) cells.set(cellKey(s, z, layer, i, j), v); };
  for (const layer of ['ground', 'object']) {
    fill(0, layer, s.runway.x, s.runway.y, s.runway.w, s.runway.h, -1);
    fill(0, layer, s.road.x, s.road.y, s.road.w, s.road.h, -2);
  }
  layout.forEach((p, i) => {
    if (layerOf(p.t) === 'edge') return edges.set(edgeKey(p.z || 0, p.r || 0, p.x, p.y), i);
    const f = footprint(p);
    for (const l of layersOf(p.t)) fill(p.z || 0, l, p.x, p.y, f.w, f.h, i);
  });
  return { cells, edges };
}

const hasFloor = (s, layout, occ, z, x, y) => {
  const i = occ.cells.get(cellKey(s, z, 'ground', x, y));
  return i >= 0 && layout[i].t === 'floor';
};

// Adds the item if it fits; returns an error key (i18n) or null.
export function place(s, occ, layout, counts, type, x, y, r = 0, z = 0) {
  const b = BUILDINGS[type], layer = b.layer;
  if (!Number.isInteger(z) || z < 0 || z >= LEVELS || (z > 0 && !b.levels)) return 'Kan ikke bygges på denne etage';
  if (b.max && (counts[type] || 0) >= b.max) return 'Maksimum nået for denne bygning';
  if (layout.length >= MAX_ITEMS) return 'Lufthavnen er fuld';
  const p = { t: type, x, y };
  if (r) p.r = r;
  if (z) p.z = z;
  if (layer === 'edge') {
    const hor = !(r & 1);
    if (x < 0 || y < 0 || x > s.w - (hor ? 1 : 0) || y > s.h - (hor ? 0 : 1)) return 'Uden for området';
    const k = edgeKey(z, r, x, y);
    if (occ.edges.has(k)) return 'Feltet er optaget';
    layout.push(p);
    occ.edges.set(k, layout.length - 1);
  } else {
    const f = footprint(p);
    if (x < 0 || y < 0 || x + f.w > s.w || y + f.h > s.h) return 'Uden for området';
    if (type === 'escalator' || type === 'stairs' || type === 'elevator') { if (z >= LEVELS - 1) return 'Kan ikke bygges på denne etage'; }
    const layers = layersOf(type);
    for (let j = y; j < y + f.h; j++) for (let i = x; i < x + f.w; i++) {
      if (layers.some(l => occ.cells.has(cellKey(s, z, l, i, j)))) return 'Feltet er optaget';
      if (z > 0 && !hasFloor(s, layout, occ, layer === 'ground' ? z - 1 : z, i, j)) return layer === 'ground' ? 'Gulvet skal stå på et gulv nedenunder' : 'Skal stå på et gulv';
    }
    layout.push(p);
    for (let j = y; j < y + f.h; j++) for (let i = x; i < x + f.w; i++) for (const l of layers) occ.cells.set(cellKey(s, z, l, i, j), layout.length - 1);
  }
  counts[type] = (counts[type] || 0) + 1;
  return null;
}

// Removes items on level z touching the rectangle (layer: all | object | ground | edge).
// Remaining runway extensions are re-packed onto the runway end.
export function removeRect(s, layout, x1, y1, x2, y2, z = 0, layer = 'all') {
  const ax = Math.min(x1, x2), bx = Math.max(x1, x2), ay = Math.min(y1, y2), by = Math.max(y1, y2);
  const keep = [], removed = [];
  for (const p of layout) {
    const l = layerOf(p.t);
    let hit = (p.z || 0) === z && (layer === 'all' || layer === l);
    if (hit) {
      if (l === 'edge') hit = p.r & 1 ? p.x >= ax && p.x <= bx + 1 && p.y >= ay && p.y <= by : p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by + 1;
      else { const f = footprint(p); hit = p.x <= bx && p.x + f.w > ax && p.y <= by && p.y + f.h > ay; }
    }
    (hit ? removed : keep).push(p);
  }
  let n = 0;
  for (const p of keep) if (p.t === 'runway_ext') p.x = s.runway.x + s.runway.w + n++ * EXT_W;
  return { keep, removed };
}

// After removing floors: anything left standing on a floor that no longer exists.
export function unsupported(s, layout) {
  const occ = occupancy(s, layout);
  return layout.filter(p => {
    const z = p.z || 0, l = layerOf(p.t);
    if (!z || l === 'edge') return false;
    const f = footprint(p);
    for (let j = p.y; j < p.y + f.h; j++) for (let i = p.x; i < p.x + f.w; i++)
      if (!hasFloor(s, layout, occ, l === 'ground' ? z - 1 : z, i, j)) return true;
    return false;
  });
}

const LEGACY_COST = { runway: 400_000 };
// v1 → v2: converts a pre-3D layout (1 tile ≈ 80 m) to the 10 m site; whatever no longer fits is refunded.
export function migrateLegacy(type, runwayM, old) {
  const s = site(type, runwayM), layout = [], occ = occupancy(s, layout), counts = {};
  let refund = 0;
  for (const p of old.filter(p => p.t === 'runway_ext')) {
    const slot = extSlot(s, layout);
    if (!slot || place(s, occ, layout, counts, 'runway_ext', slot.x, slot.y)) refund += BUILDINGS.runway_ext.cost;
  }
  for (const p of old) {
    if (p.t === 'runway_ext' || (p.t === 'runway' && p.x === 1 && p.y === 0)) continue; // starter runway = main runway now
    if (!BUILDINGS[p.t] || place(s, occ, layout, counts, p.t, p.x * 8 + 4, p.y * 8 + 10)) refund += LEGACY_COST[p.t] ?? BUILDINGS[p.t]?.cost ?? 0;
  }
  return { layout, refund };
}

// v2 → v3: buildings now need real access. Lay a free straight road down to the access road for land items,
// and a taxiway up to the runway for air items, so existing airports keep working.
export function connectLegacy(type, runwayM, layout) {
  const s = site(type, runwayM), out = layout.filter(p => BUILDINGS[p.t]), occ = occupancy(s, out), counts = countTypes(out);
  const free = (x, y) => !occ.cells.has(cellKey(s, 0, 'ground', x, y)) && !occ.cells.has(cellKey(s, 0, 'object', x, y));
  for (const p of [...out]) {
    const a = BUILDINGS[p.t].access;
    if (!a || p.z) continue;
    const f = footprint(p);
    const lay = (tile, from, to) => {
      for (let x = p.x; x < p.x + f.w; x++) {
        const ys = []; for (let y = from; from < to ? y < to : y > to; y += from < to ? 1 : -1) ys.push(y);
        if (ys.every(y => free(x, y))) { ys.forEach(y => place(s, occ, out, counts, tile, x, y)); return; }
      }
    };
    if (a === 'land' || a === 'both') lay('road', p.y + f.h, s.road.y);
    if (a === 'air' || a === 'both') lay('taxiway', p.y - 1, s.runway.y + s.runway.h - 1);
  }
  return out;
}
