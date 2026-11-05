// Works out which items actually function: road/taxiway connectivity, closed buildings, upper floors.
import { BUILDINGS, LEVELS, TERMINAL_RATES } from './catalog.js';
import { footprint, layerOf } from './layout.js';

const cache = new Map();
export function analyze(layout, s) {
  const key = s.w + ':' + s.h + ':' + s.runway.w + ':' + JSON.stringify(layout);
  if (cache.has(key)) return cache.get(key);
  const out = run(layout, s);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

const AIR_PAVING = new Set(['taxiway', 'apron', 'runway', 'runway_ext', 'gate_s', 'gate_m', 'gate_l', 'stand_s', 'stand_m', 'stand_l']);
const LAND_PAVING = new Set(['road', 'path', 'parking']);
const LIFTS = new Set(['stairs', 'escalator', 'elevator']);

function run(layout, s) {
  const { w, h } = s, N = w * h;
  const idx = (x, y) => y * w + x;
  const ground = Array.from({ length: LEVELS }, () => new Int32Array(N).fill(-1));
  const object = Array.from({ length: LEVELS }, () => new Int32Array(N).fill(-1));
  const hEdge = Array.from({ length: LEVELS }, () => new Uint8Array(w * (h + 1))); // 1 wall, 2 door
  const vEdge = Array.from({ length: LEVELS }, () => new Uint8Array((w + 1) * h));
  const fixedRunway = new Uint8Array(N), fixedRoad = new Uint8Array(N);
  for (let y = s.runway.y; y < s.runway.y + s.runway.h; y++) for (let x = s.runway.x; x < s.runway.x + s.runway.w; x++) fixedRunway[idx(x, y)] = 1;
  for (let y = s.road.y; y < s.road.y + s.road.h; y++) for (let x = 0; x < w; x++) fixedRoad[idx(x, y)] = 1;

  layout.forEach((p, i) => {
    const z = p.z || 0, l = layerOf(p.t);
    if (l === 'edge') {
      const v = p.t === 'door' ? 2 : 1;
      if (p.r & 1) vEdge[z][p.y * (w + 1) + p.x] = v; else hEdge[z][p.y * w + p.x] = v;
      return;
    }
    const f = footprint(p), grid = l === 'ground' ? ground[z] : object[z];
    for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) grid[idx(x, y)] = i;
  });
  const typeAt = (grid, c) => (grid[c] >= 0 ? layout[grid[c]].t : null);
  // Edge between neighbouring cells a → b (dx, dy ∈ {−1,0,1}) on level z.
  const edgeBetween = (z, x, y, dx, dy) => (dx ? vEdge[z][y * (w + 1) + x + (dx > 0 ? 1 : 0)] : hEdge[z][(y + (dy > 0 ? 1 : 0)) * w + x]);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const flood = (seed, passable) => {
    const seen = new Uint8Array(N), q = [];
    for (let c = 0; c < N; c++) if (seed(c)) { seen[c] = 1; q.push(c); }
    while (q.length) {
      const c = q.pop(), x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (!seen[n] && passable(n)) { seen[n] = 1; q.push(n); }
      }
    }
    return seen;
  };
  // Airside: from every runway through taxiway/apron/stand paving.
  const airPaved = c => fixedRunway[c] || AIR_PAVING.has(typeAt(ground[0], c)) || AIR_PAVING.has(typeAt(object[0], c));
  const air = flood(c => fixedRunway[c] || ['runway', 'runway_ext'].includes(typeAt(object[0], c)), airPaved);
  // Landside: from the access road through roads, paths and car parks.
  const land = flood(c => fixedRoad[c], c => LAND_PAVING.has(typeAt(ground[0], c)) || LAND_PAVING.has(typeAt(object[0], c)));

  const touches = (p, net) => {
    const f = footprint(p);
    for (let y = p.y - 1; y <= p.y + f.h; y++) for (let x = p.x - 1; x <= p.x + f.w; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const inside = x >= p.x && x < p.x + f.w && y >= p.y && y < p.y + f.h;
      if (net[idx(x, y)] && (!inside || AIR_PAVING.has(p.t))) return true;
    }
    return false;
  };

  // Buildings: a floor cell is indoors when no wall-free path leads outside. Rooms join through doors.
  const comp = Array.from({ length: LEVELS }, () => new Int32Array(N).fill(-1));
  const comps = []; // { z, cells: [], entrance, functional }
  for (let z = 0; z < LEVELS; z++) {
    const isFloor = c => typeAt(ground[z], c) === 'floor';
    const exposed = new Uint8Array(N), q = [];
    for (let c = 0; c < N; c++) {
      const x = c % w, y = (c / w) | 0;
      const border = (x === 0 && !vEdge[z][y * (w + 1)]) || (x === w - 1 && !vEdge[z][y * (w + 1) + w]) || (y === 0 && !hEdge[z][x]) || (y === h - 1 && !hEdge[z][h * w + x]);
      if (!isFloor(c) || border) { exposed[c] = 1; q.push(c); }
    }
    while (q.length) {
      const c = q.pop(), x = c % w, y = (c / w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (!exposed[n] && !edgeBetween(z, x, y, dx, dy)) { exposed[n] = 1; q.push(n); }
      }
    }
    for (let c = 0; c < N; c++) {
      if (exposed[c] || comp[z][c] >= 0) continue;
      const id = comps.length, cells = [c], cq = [c];
      comp[z][c] = id;
      let entrance = false;
      while (cq.length) {
        const a = cq.pop(), x = a % w, y = (a / w) | 0;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy, e = edgeBetween(z, x, y, dx, dy);
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = idx(nx, ny);
          if (exposed[n]) { if (z === 0 && e === 2 && land[n]) entrance = true; continue; }
          if (e === 1 || comp[z][n] >= 0) continue;
          comp[z][n] = id; cells.push(n); cq.push(n);
        }
      }
      comps.push({ z, cells, entrance, functional: z === 0 && entrance, lift: 0 });
    }
  }
  // Upper floors work when a stair/escalator/elevator in a working room below leads up into them.
  for (let z = 1; z < LEVELS; z++) {
    layout.forEach(p => {
      if ((p.z || 0) !== z - 1 || !LIFTS.has(p.t)) return;
      const below = comps[comp[z - 1][idx(p.x, p.y)]];
      if (!below?.functional) return;
      const f = footprint(p);
      const ups = new Set();
      for (let y = p.y; y < p.y + f.h; y++) for (let x = p.x; x < p.x + f.w; x++) { const u = comp[z][idx(x, y)]; if (u >= 0) ups.add(u); }
      for (const u of ups) { comps[u].functional = true; comps[u].lift += BUILDINGS[p.t].effect.lift; }
    });
  }

  // Which items work, and why not.
  const working = new Array(layout.length).fill(true), why = [];
  const fail = (i, reason) => { working[i] = false; why.push([i, reason]); };
  const indoorComp = p => comp[p.z || 0][idx(p.x, p.y)];
  layout.forEach((p, i) => {
    const b = BUILDINGS[p.t];
    if (b.indoor) {
      const c = comps[indoorComp(p)];
      if (!c) return fail(i, 'Står udenfor – skal være inde i en lukket bygning');
      if (!c.functional) return fail(i, c.z ? 'Etagen mangler trappe, rulletrappe eller elevator' : 'Bygningen mangler en dør ud mod fortov eller vej');
    }
    if ((b.access === 'land' || b.access === 'both') && !touches(p, land)) return fail(i, 'Mangler vejadgang');
    if ((b.access === 'air' || b.access === 'both') && !touches(p, air)) return fail(i, 'Mangler forbindelse til banen via taxivej eller forplads');
    if (p.t === 'taxiway' && !air[idx(p.x, p.y)]) return fail(i, 'Taxivejen er ikke forbundet med banen');
  });

  // Custom terminals: floor area and the processing chain inside working buildings; the smallest link decides.
  const area = Array(LEVELS).fill(0), lift = Array(LEVELS).fill(0);
  for (const c of comps) if (c.functional) {
    area[c.z] += c.cells.filter(cell => typeAt(ground[c.z], cell) === 'floor').length;
    lift[c.z] += c.lift;
  }
  let usable = area[0];
  for (let z = 1; z < LEVELS; z++) usable += Math.min(area[z], lift[z]);
  const counts = { area: usable, checkin: 0, security: 0, baggage: 0, toilets: 0, seats: 0 };
  layout.forEach((p, i) => {
    if (!working[i]) return;
    const e = BUILDINGS[p.t].effect;
    for (const k of ['checkin', 'security', 'baggage', 'toilets', 'seats']) counts[k] += e[k] || 0;
  });
  const caps = Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n * TERMINAL_RATES[k]]));
  const bottleneck = Object.entries(caps).reduce((a, b) => (b[1] < a[1] ? b : a));
  const custom = { counts, caps, cap: usable ? bottleneck[1] : 0, bottleneck: usable ? bottleneck[0] : null, buildings: comps.filter(c => c.functional).length };

  const issues = {};
  for (const [, reason] of why) issues[reason] = (issues[reason] || 0) + 1;
  return { working, why: why.slice(0, 2000), custom, issues };
}
