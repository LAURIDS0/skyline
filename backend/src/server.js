import express from 'express';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool, init } from './db.js';
import * as C from './catalog.js';
import { AIRCRAFT, BUILDINGS, AIRPORT_PRICE, LICENSES, requirements, fuelPrice } from './catalog.js';
import { site, extSlot, occupancy, place, countTypes, removeRect, unsupported } from './layout.js';
import { computeEconomy, distanceKm, slotsFit, slotNeeds, hubStats, hasBuilding, hangarNeed } from './economy.js';
import { hubWeather } from './weather.js';

const scrypt = promisify(crypto.scrypt);
const app = express();
app.use(express.json({ limit: '300kb' })); // paint strokes send up to MAX_BATCH cells

// Error messages are Danish templates with {params}; the frontend uses the template as an i18n key.
const fill = (key, params = {}) => key.replace(/\{(\w+)\}/g, (_, k) => [].concat(params[k] ?? '').join(', '));
class HttpError extends Error { constructor(status, key, params) { super(fill(key, params)); Object.assign(this, { status, key, params }); } }
const fail = (status, key, params) => { throw new HttpError(status, key, params); };
const q = (sql, p) => pool.query(sql, p);
const one = async (sql, p) => (await q(sql, p))[0];
const marks = arr => arr.map(() => '?').join(',');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const int = v => (Number.isInteger(+v) ? +v : fail(400, 'Ugyldigt tal'));
const BNAME = Object.fromEntries(Object.entries(BUILDINGS).map(([k, b]) => [k, b.name]));

async function tx(fn) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; }
  catch (e) { await c.rollback(); throw e; }
  finally { c.release(); }
}
async function pay(c, uid, amount) {
  const r = await c.query('UPDATE users SET cash = cash - ? WHERE id = ? AND cash >= ?', [amount, uid, amount]);
  if (!r.affectedRows) fail(400, 'Ikke nok penge');
}

// ---------- auth ----------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(pw, salt, 64)).toString('hex')}`;
}
async function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), await scrypt(pw, salt, 64));
}
async function newSession(uid) {
  const token = crypto.randomBytes(32).toString('hex');
  await q('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [sha256(token), uid]);
  return token;
}
async function auth(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer /, '');
  const s = token && await one('SELECT user_id FROM sessions WHERE token = ?', [sha256(token)]);
  if (!s) return res.status(401).json({ error: 'Log ind igen', key: 'Log ind igen' });
  req.uid = s.user_id;
  next();
}

const COLORS = ['#f5b942', '#4fd1c5', '#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fb923c', '#f87171', '#facc15', '#38bdf8'];

app.post('/api/register', async (req, res) => {
  const { username, password, company } = req.body;
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username || '')) fail(400, 'Brugernavn: 3-24 tegn, bogstaver/tal/_');
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400, 'Adgangskode: mindst 8 tegn');
  const name = String(company || '').trim();
  if (name.length < 2 || name.length > 40) fail(400, 'Selskabsnavn: 2-40 tegn');
  const r = await q('INSERT INTO users (username, company, pass_hash, cash, last_tick, color) VALUES (?,?,?,?,?,?)',
    [username, name, await hashPassword(password), C.START_CASH, Date.now(), COLORS[Math.floor(Math.random() * COLORS.length)]]);
  res.json({ token: await newSession(r.insertId) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = typeof password === 'string' && await one('SELECT id, pass_hash FROM users WHERE username = ?', [String(username)]);
  if (!u || !(await checkPassword(password, u.pass_hash))) fail(401, 'Forkert brugernavn eller adgangskode');
  res.json({ token: await newSession(u.id) });
});

app.post('/api/logout', auth, async (req, res) => {
  await q('DELETE FROM sessions WHERE token = ?', [sha256(req.get('authorization').slice(7))]);
  res.json({ ok: true });
});

// ---------- economy ----------
async function loadEconomy(uid, { debt, cash }, override) {
  let aircraft = await q('SELECT id, model, base_id, dest_id, fare_mult, cond FROM aircraft WHERE user_id = ?', [uid]);
  if (override) aircraft = aircraft.map(a => (a.id === override.id ? { ...a, ...override } : a));
  const owned = Object.fromEntries((await q('SELECT airport_id, layout FROM owned_airports WHERE user_id = ?', [uid]))
    .map(o => [o.airport_id, JSON.parse(o.layout)]));
  const routed = aircraft.filter(a => a.dest_id);
  const competitors = routed.length ? await q(
    `SELECT model, base_id, dest_id, fare_mult FROM aircraft WHERE dest_id IS NOT NULL AND cond >= ? AND user_id <> ?
     AND (base_id, dest_id) IN (${routed.flatMap(() => ['(?,?)', '(?,?)']).join(',')})`,
    [C.GROUNDED_BELOW, uid, ...routed.flatMap(a => [a.base_id, a.dest_id, a.dest_id, a.base_id])]) : [];
  const ids = [...new Set([...Object.keys(owned).map(Number), ...aircraft.flatMap(a => [a.base_id, a.dest_id]).filter(Boolean)])];
  const airports = ids.length ? Object.fromEntries((await q(`SELECT id, lat, lon, type, runway_m FROM airports WHERE id IN (${marks(ids)})`, ids)).map(a => [a.id, a])) : {};
  const sites = Object.fromEntries(Object.keys(owned).map(id => [id, site(airports[id].type, airports[id].runway_m)]));
  const dests = routed.map(a => a.dest_id);
  const ownerOf = dests.length ? Object.fromEntries((await q(`SELECT airport_id, user_id FROM owned_airports WHERE airport_id IN (${marks(dests)})`, dests)).map(o => [o.airport_id, o.user_id])) : {};
  const weather = Object.fromEntries(Object.keys(owned).map(id => [id, hubWeather(id, airports[id].lat, airports[id].lon)]));
  return computeEconomy({ uid, aircraft, competitors, owned, sites, airports, ownerOf, weather, fuel: fuelPrice(), debt, cash });
}

// Lazily credit earnings, XP and wear since last tick. Optimistic lock on last_tick prevents double-crediting.
async function settle(uid) {
  const u = await one('SELECT last_tick, last_hist, debt, cash FROM users WHERE id = ?', [uid]);
  const now = Date.now();
  const hours = Math.min(now - u.last_tick, C.OFFLINE_CAP_H * 3600_000) / 1000 * C.MONEY_HOURS_PER_SEC;
  const eco = await loadEconomy(uid, u);
  const t = eco.totals;
  const r = await q('UPDATE users SET cash = cash + ?, xp = xp + ?, last_tick = ? WHERE id = ? AND last_tick = ?',
    [t.profit * hours, (t.pax + t.cargoT * 10) * hours, now, uid, u.last_tick]);
  if (!r.affectedRows) return eco;
  for (const [owner, perHour] of Object.entries(eco.feesTo)) await q('UPDATE users SET cash = cash + ? WHERE id = ?', [perHour * hours, owner]);
  const wear = Object.entries(eco.routes).filter(([, e]) => e.flightH > 0).map(([id, e]) => [e.flightH * hours * C.WEAR_PER_FLIGHT_H, +id]);
  if (wear.length) await pool.batch('UPDATE aircraft SET cond = GREATEST(0, cond - ?) WHERE id = ?', wear);
  if (now - u.last_hist > C.HISTORY_EVERY_MS) {
    await q('INSERT INTO history (user_id, ts, cash, profit) VALUES (?,?,?,?)', [uid, now, u.cash + t.profit * hours, t.profit]);
    await q('UPDATE users SET last_hist = ? WHERE id = ?', [now, uid]);
    await q('DELETE FROM history WHERE user_id = ? AND ts < ?', [uid, now - 86_400_000]);
  }
  const { cash } = await one('SELECT cash FROM users WHERE id = ?', [uid]);
  const { n } = await one('SELECT COUNT(*) n FROM owned_airports WHERE user_id = ?', [uid]);
  if (cash < -bankruptLimit(n)) {
    await bankrupt(uid, cash, n);
    return loadEconomy(uid, { debt: 0, cash: C.START_CASH });
  }
  return eco;
}

const bankruptLimit = airports => C.BANKRUPT_DEBT_PER_AIRPORT * Math.max(1, airports);

// The bank takes over every airport and aircraft; the company restarts from scratch.
async function bankrupt(uid, cash, airports) {
  await tx(async c => {
    const [{ planes }] = await c.query('SELECT COUNT(*) planes FROM aircraft WHERE user_id = ?', [uid]);
    const [u] = await c.query('SELECT debt FROM users WHERE id = ? FOR UPDATE', [uid]);
    await c.query('DELETE FROM aircraft WHERE user_id = ?', [uid]);
    await c.query('DELETE FROM owned_airports WHERE user_id = ?', [uid]);
    await c.query('DELETE FROM history WHERE user_id = ?', [uid]);
    const notice = JSON.stringify({ at: Date.now(), overdraft: -cash, loans: u.debt, airports, planes, limit: bankruptLimit(airports) });
    await c.query(
      `UPDATE users SET cash = ?, debt = 0, xp = 0, license = 0, last_tick = ?, last_hist = 0,
         bankruptcies = bankruptcies + 1, bankrupt_notice = ? WHERE id = ?`,
      [C.START_CASH, Date.now(), notice, uid]);
  });
}

async function effectiveRunway(c, airportId) {
  const [row] = await c.query('SELECT a.runway_m, o.layout FROM airports a LEFT JOIN owned_airports o ON o.airport_id = a.id WHERE a.id = ?', [airportId]);
  if (!row) return null;
  return row.runway_m + (row.layout ? hubStats(JSON.parse(row.layout)).runwayExt * C.RUNWAY_EXTENSION_M : 0);
}

// shortcut: valued in JS over all rows; move to a cached/periodic job once there are thousands of players.
async function companyValues() {
  const users = await q('SELECT id, company, color, cash, debt, license, avatar_ver FROM users');
  const value = Object.fromEntries(users.map(u => [u.id, { ...u, assets: 0, planes: 0, airports: 0 }]));
  for (const a of await q('SELECT user_id, model FROM aircraft')) {
    value[a.user_id].assets += AIRCRAFT[a.model].price * C.SELL_FACTOR;
    value[a.user_id].planes++;
  }
  for (const o of await q('SELECT o.user_id, o.layout, a.type FROM owned_airports o JOIN airports a ON a.id = o.airport_id')) {
    value[o.user_id].assets += 0.6 * (AIRPORT_PRICE[o.type] + JSON.parse(o.layout).reduce((s, p) => s + BUILDINGS[p.t].cost, 0));
    value[o.user_id].airports++;
  }
  return Object.values(value).map(({ cash, debt, ...v }) => ({ ...v, value: cash - debt + v.assets }))
    .sort((a, b) => b.value - a.value);
}
const creditLimit = assets => 2_000_000 + 0.5 * assets;

// ---------- read endpoints ----------
const catalogOut = {
  AIRCRAFT: Object.fromEntries(Object.entries(AIRCRAFT).map(([k, m]) => [k, { ...m, req: requirements(m) }])),
  BUILDINGS, AIRPORT_PRICE, LICENSES, TILE_M: C.TILE_M, MAX_BATCH: C.MAX_BATCH, CATEGORIES: C.CATEGORIES, START_CASH: C.START_CASH,
  GAME_HOURS_PER_SEC: C.GAME_HOURS_PER_SEC, MONEY_HOURS_PER_SEC: C.MONEY_HOURS_PER_SEC, GAME_EPOCH: C.GAME_EPOCH,
  TURNAROUND_H: C.TURNAROUND_H, MIN_ROUTE_KM: C.MIN_ROUTE_KM, GROUNDED_BELOW: C.GROUNDED_BELOW, OVERHAUL_COST: C.OVERHAUL_COST,
  SELL_FACTOR: C.SELL_FACTOR, RUNWAY_EXTENSION_M: C.RUNWAY_EXTENSION_M, BANKRUPT_DEBT_PER_AIRPORT: C.BANKRUPT_DEBT_PER_AIRPORT, MAP_KEY: process.env.CARTO_KEY || '',
};
app.get('/api/catalog', (req, res) => res.json(catalogOut));

app.get('/api/state', auth, async (req, res) => {
  const eco = await settle(req.uid);
  const user = await one('SELECT id, username, company, cash, color, xp, license, debt, bio, lang, avatar_ver, bankruptcies, bankrupt_notice FROM users WHERE id = ?', [req.uid]);
  user.bankrupt_notice = user.bankrupt_notice && JSON.parse(user.bankrupt_notice);
  const { n: airportCount } = await one('SELECT COUNT(*) n FROM owned_airports WHERE user_id = ?', [req.uid]);
  const mine = (await companyValues()).find(v => v.id === req.uid);
  const owned = (await q(
    `SELECT o.airport_id id, o.layout, a.name, a.iata, a.ident, a.lat, a.lon, a.type, a.runway_m, a.city, a.country
     FROM owned_airports o JOIN airports a ON a.id = o.airport_id WHERE o.user_id = ? ORDER BY o.bought_at`, [req.uid]))
    .map(o => {
      const stats = eco.hubs[o.id];
      const layout = JSON.parse(o.layout), s = site(o.type, o.runway_m);
      return { ...o, layout, stats, site: s, extSlot: extSlot(s, layout), runway_eff: o.runway_m + stats.runwayExt * C.RUNWAY_EXTENSION_M };
    });
  const fleet = (await q(
    `SELECT ac.id, ac.model, ac.base_id, ac.dest_id, ac.fare_mult, ac.cond,
       b.iata base_iata, b.ident base_ident, b.lat blat, b.lon blon, d.iata dest_iata, d.ident dest_ident, d.name dest_name, d.lat dlat, d.lon dlon
     FROM aircraft ac JOIN airports b ON b.id = ac.base_id LEFT JOIN airports d ON d.id = ac.dest_id
     WHERE ac.user_id = ? ORDER BY ac.id`, [req.uid]))
    .map(a => ({ ...a, econ: eco.routes[a.id] }));
  const history = await q('SELECT ts, cash, profit FROM history WHERE user_id = ? ORDER BY ts', [req.uid]);
  res.json({
    user: { ...user, value: mine.value, credit: creditLimit(mine.assets), bankruptAt: -bankruptLimit(airportCount) },
    owned, fleet, history, totals: eco.totals, fuel: fuelPrice(), serverTime: Date.now(),
  });
});

app.get('/api/airports', async (req, res) => {
  const [s, w, n, e] = ['s', 'w', 'n', 'e'].map(k => Number(req.query[k]));
  if ([s, w, n, e].some(Number.isNaN)) fail(400, 'Ugyldigt område');
  const zoom = Number(req.query.z) || 3;
  const types = zoom < 5 ? ['large_airport'] : zoom < 7 ? ['large_airport', 'medium_airport'] : ['large_airport', 'medium_airport', 'small_airport'];
  res.json(await q(
    `SELECT a.id, a.iata, a.ident, a.name, a.lat, a.lon, a.type, u.color owner_color, u.id owner_id
     FROM airports a LEFT JOIN owned_airports o ON o.airport_id = a.id LEFT JOIN users u ON u.id = o.user_id
     WHERE a.lat BETWEEN ? AND ? AND a.lon BETWEEN ? AND ? AND a.type IN (${marks(types)})
     ORDER BY FIELD(a.type, 'large_airport', 'medium_airport', 'small_airport') LIMIT 2500`,
    [s, n, Math.max(w, -180), Math.min(e, 180), ...types]));
});

app.get('/api/airports/search', async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2 || term.length > 40) return res.json([]);
  res.json(await q(
    `SELECT id, iata, ident, name, city, country, lat, lon, type FROM airports
     WHERE iata = ? OR ident = ? OR name LIKE ? OR city LIKE ?
     ORDER BY iata = ? DESC, FIELD(type, 'large_airport', 'medium_airport', 'small_airport') LIMIT 12`,
    [term.toUpperCase(), term.toUpperCase(), `%${term}%`, `${term}%`, term.toUpperCase()]));
});

app.get('/api/airports/:id', async (req, res) => {
  const id = int(req.params.id);
  const a = await one(
    `SELECT a.*, u.company owner_company, u.color owner_color, u.id owner_id,
       (SELECT COUNT(*) FROM aircraft WHERE dest_id = a.id OR base_id = a.id) flights
     FROM airports a LEFT JOIN owned_airports o ON o.airport_id = a.id LEFT JOIN users u ON u.id = o.user_id WHERE a.id = ?`,
    [id]) || fail(404, 'Ukendt lufthavn');
  res.json({ ...a, price: AIRPORT_PRICE[a.type], runway_eff: await effectiveRunway(pool, id) });
});

app.get('/api/world', async (req, res) => {
  const routes = await q(
    `SELECT DISTINCT ac.user_id uid, u.color, b.lat blat, b.lon blon, d.lat dlat, d.lon dlon
     FROM aircraft ac JOIN users u ON u.id = ac.user_id JOIN airports b ON b.id = ac.base_id JOIN airports d ON d.id = ac.dest_id
     LIMIT 5000`);
  res.json({ routes });
});

app.get('/api/leaderboard', async (req, res) => res.json((await companyValues()).slice(0, 50)));

app.get('/api/users/:id', async (req, res) => {
  const id = int(req.params.id);
  const u = await one('SELECT id, username, company, color, created_at, license, xp, bio, avatar_ver, bankruptcies FROM users WHERE id = ?', [id]) || fail(404, 'Ukendt spiller');
  const ranking = await companyValues();
  const rank = ranking.findIndex(r => r.id === id);
  const airports = await q(
    `SELECT a.id, a.iata, a.ident, a.name, a.city, a.country, a.type, a.lat, a.lon,
       (SELECT COUNT(*) FROM aircraft WHERE base_id = a.id) based
     FROM owned_airports o JOIN airports a ON a.id = o.airport_id WHERE o.user_id = ? ORDER BY o.bought_at`, [id]);
  const fleet = await q('SELECT model, COUNT(*) n FROM aircraft WHERE user_id = ? GROUP BY model', [id]);
  const routes = await q(
    `SELECT b.iata base_iata, b.ident base_ident, d.iata dest_iata, d.ident dest_ident, COUNT(*) planes
     FROM aircraft ac JOIN airports b ON b.id = ac.base_id JOIN airports d ON d.id = ac.dest_id
     WHERE ac.user_id = ? GROUP BY ac.base_id, ac.dest_id`, [id]);
  res.json({ ...u, rank: rank + 1, players: ranking.length, value: ranking[rank].value, airports, fleet, routes });
});

// ---------- company ----------
app.post('/api/license', auth, async (req, res) => {
  await settle(req.uid);
  await tx(async c => {
    const [u] = await c.query('SELECT license, xp FROM users WHERE id = ? FOR UPDATE', [req.uid]);
    const next = LICENSES[u.license + 1] || fail(400, 'Du har allerede den højeste licens');
    if (u.xp < next.xp) fail(400, 'Kræver {xp} erfaringspoint', { xp: next.xp });
    await pay(c, req.uid, next.cost);
    await c.query('UPDATE users SET license = license + 1 WHERE id = ?', [req.uid]);
  });
  res.json({ ok: true });
});

app.post('/api/loan', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || !amount || Math.abs(amount) > 1e12) fail(400, 'Ugyldigt beløb');
  await settle(req.uid);
  const assets = (await companyValues()).find(v => v.id === req.uid).assets;
  await tx(async c => {
    const [u] = await c.query('SELECT debt FROM users WHERE id = ? FOR UPDATE', [req.uid]);
    if (amount > 0) {
      if (u.debt + amount > creditLimit(assets)) fail(400, 'Banken vil ikke låne dig så meget');
      await c.query('UPDATE users SET debt = debt + ?, cash = cash + ? WHERE id = ?', [amount, amount, req.uid]);
    } else {
      const repay = Math.min(-amount, u.debt);
      await pay(c, req.uid, repay);
      await c.query('UPDATE users SET debt = debt - ? WHERE id = ?', [repay, req.uid]);
    }
  });
  res.json({ ok: true });
});

// ---------- airports ----------
app.post('/api/airports/:id/buy', auth, async (req, res) => {
  const ap = await one('SELECT id, type FROM airports WHERE id = ?', [int(req.params.id)]) || fail(404, 'Ukendt lufthavn');
  await settle(req.uid);
  await tx(async c => {
    await pay(c, req.uid, AIRPORT_PRICE[ap.type]);
    await c.query('INSERT INTO owned_airports (airport_id, user_id, layout, layout_v) VALUES (?,?,?,3)', [ap.id, req.uid, JSON.stringify(C.STARTER_LAYOUT)]);
  });
  res.json({ ok: true });
});

async function lockOwned(c, airportId, uid) {
  const [row] = await c.query(
    'SELECT o.layout, a.type, a.runway_m FROM owned_airports o JOIN airports a ON a.id = o.airport_id WHERE o.airport_id = ? AND o.user_id = ? FOR UPDATE',
    [airportId, uid]);
  if (!row) fail(404, 'Ikke din lufthavn');
  return { layout: JSON.parse(row.layout), type: row.type, runway_m: row.runway_m, site: site(row.type, row.runway_m) };
}
const saveLayout = (c, id, layout) => c.query('UPDATE owned_airports SET layout = ? WHERE airport_id = ?', [JSON.stringify(layout), id]);
const rot = v => (v == null ? 0 : [0, 1, 2, 3].includes(+v) ? +v : fail(400, 'Ugyldigt tal'));

// Places one item, or many (a paint stroke: cells = [[x, y], …]). Runway extensions go to the runway end automatically.
app.post('/api/airports/:id/build', auth, async (req, res) => {
  const id = int(req.params.id), { type } = req.body, r = rot(req.body.r), z = req.body.z == null ? 0 : int(req.body.z);
  if (!Object.hasOwn(BUILDINGS, type)) fail(400, 'Ukendt bygning');
  const b = BUILDINGS[type];
  const cells = b.auto ? [[0, 0]] : Array.isArray(req.body.cells) ? req.body.cells : [[req.body.x, req.body.y]];
  if (!cells.length || cells.length > C.MAX_BATCH || (cells.length > 1 && !b.paint)) fail(400, 'Ugyldigt område');
  const xy = cells.map(cell => (Array.isArray(cell) ? [int(cell[0]), int(cell[1]), cell[2] == null ? r : rot(cell[2])] : fail(400, 'Ugyldigt område')));
  await settle(req.uid);
  const layout = await tx(async c => {
    const ap = await lockOwned(c, id, req.uid);
    const occ = occupancy(ap.site, ap.layout), counts = countTypes(ap.layout);
    let placed = 0, err = null;
    for (const [x, y, cr] of xy) {
      const slot = b.auto && (extSlot(ap.site, ap.layout) || fail(400, 'Maksimum nået for denne bygning'));
      err = place(ap.site, occ, ap.layout, counts, type, slot ? slot.x : x, slot ? slot.y : y, b.rot || b.layer === 'edge' ? cr : 0, z);
      if (!err) placed++;
    }
    if (!placed) fail(400, err); // a paint stroke skips occupied cells; a single item must fit
    await pay(c, req.uid, b.cost * placed);
    await saveLayout(c, id, ap.layout);
    return ap.layout;
  });
  res.json({ layout });
});

// Demolishes everything touching the rectangle (a click is a 1×1 rectangle) and refunds 25%.
app.post('/api/airports/:id/demolish', auth, async (req, res) => {
  const id = int(req.params.id);
  const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map(k => int(req.body[k] ?? req.body[k[0]]));
  const z = req.body.z == null ? 0 : int(req.body.z), layer = ['all', 'object', 'ground', 'edge'].includes(req.body.layer) ? req.body.layer : 'all';
  if (Math.abs(x2 - x1) * Math.abs(y2 - y1) > C.MAX_BATCH * 4) fail(400, 'Ugyldigt område');
  await settle(req.uid);
  const layout = await tx(async c => {
    const ap = await lockOwned(c, id, req.uid);
    const { keep, removed } = removeRect(ap.site, ap.layout, x1, y1, x2, y2, z, layer);
    if (!removed.length) fail(400, 'Ingen bygning her');
    if (unsupported(ap.site, keep).length) fail(400, 'Noget står ovenpå – fjern det først');
    const based = await c.query('SELECT model FROM aircraft WHERE base_id = ? AND user_id = ?', [id, req.uid]);
    const hub = hubStats(keep, ap.site);
    if (!slotsFit(hub, slotNeeds(based))) fail(400, 'Gaten/standen bruges af et fly – sælg eller flyt flyet først');
    const missing = [...new Set(based.flatMap(a => requirements(AIRCRAFT[a.model]).filter(q => !hasBuilding(hub, q))))];
    if (missing.length) fail(400, 'Dine fly her kræver {name}', { name: missing.map(q => BNAME[q]) });
    const runway = ap.runway_m + hub.runwayExt * C.RUNWAY_EXTENSION_M;
    if (based.some(a => AIRCRAFT[a.model].runwayM > runway)) fail(400, 'Banen er for kort ({runway} m, kræver {need} m)', { runway, need: Math.max(...based.map(a => AIRCRAFT[a.model].runwayM)) });
    await saveLayout(c, id, keep);
    await c.query('UPDATE users SET cash = cash + ? WHERE id = ?', [removed.reduce((s, p) => s + BUILDINGS[p.t].cost, 0) * 0.25, req.uid]);
    return keep;
  });
  res.json({ layout });
});

// ---------- aircraft ----------
app.post('/api/aircraft', auth, async (req, res) => {
  const { model } = req.body, baseId = int(req.body.base_id);
  if (!Object.hasOwn(AIRCRAFT, model)) fail(400, 'Ukendt flytype');
  const m = AIRCRAFT[model];
  await settle(req.uid);
  await tx(async c => {
    const ap = await lockOwned(c, baseId, req.uid);
    const [u] = await c.query('SELECT license FROM users WHERE id = ?', [req.uid]);
    if (u.license < m.license) fail(400, 'Kræver licensen {name}', { name: LICENSES[m.license].name });
    const runway = await effectiveRunway(c, baseId);
    if (runway < m.runwayM) fail(400, 'Banen er for kort ({runway} m, kræver {need} m)', { runway, need: m.runwayM });
    const hub = hubStats(ap.layout, ap.site);
    const missing = requirements(m).filter(r => !hasBuilding(hub, r));
    if (missing.length) fail(400, 'Lufthavnen mangler: {list}', { list: missing.map(r => BNAME[r]) });
    const based = await c.query('SELECT model FROM aircraft WHERE base_id = ? AND user_id = ?', [baseId, req.uid]);
    if (hangarNeed([...based, { model }]) > hub.hangar) fail(400, 'For få hangarpladser ({have} ledige, kræver {need}) – byg en hangar', { have: Math.max(0, hub.hangar - hangarNeed(based)), need: C.HANGAR_SLOTS[m.size] });
    if (!slotsFit(hub, slotNeeds([...based, { model }]))) fail(400, m.cat === 'cargo' ? 'Ingen ledig fragtstand i klasse {size}' : 'Ingen ledig gate i klasse {size}', { size: m.size });
    await pay(c, req.uid, m.price);
    await c.query('INSERT INTO aircraft (user_id, model, base_id) VALUES (?,?,?)', [req.uid, model, baseId]);
  });
  res.json({ ok: true });
});

async function routeError(ac, uid, destId) {
  if (!destId) return null;
  const m = AIRCRAFT[ac.model];
  const [from, to] = await Promise.all([ac.base_id, destId].map(i => one('SELECT lat, lon FROM airports WHERE id = ?', [i])));
  if (!to || destId === ac.base_id) return { key: 'Ugyldig destination' };
  const km = distanceKm(from, to);
  const { license } = await one('SELECT license FROM users WHERE id = ?', [uid]);
  if (km < C.MIN_ROUTE_KM) return { key: 'Ruten skal være mindst {km} km', params: { km: C.MIN_ROUTE_KM } };
  if (km > m.rangeKm) return { key: 'For langt: {km} km, rækkevidde {range} km', params: { km: Math.round(km), range: m.rangeKm } };
  const lic = LICENSES[license];
  if (km > lic.maxKm) return { key: 'Din licens ({name}) tillader maks {km} km', params: { name: lic.name, km: lic.maxKm } };
  const runway = await effectiveRunway(pool, destId);
  if (runway < m.runwayM) return { key: 'Destinationens bane er for kort ({runway} m, kræver {need} m)', params: { runway, need: m.runwayM } };
  return null;
}
const ownAircraft = async (id, uid) => await one('SELECT * FROM aircraft WHERE id = ? AND user_id = ?', [int(id), uid]) || fail(404, 'Ukendt fly');

app.get('/api/aircraft/:id/preview', auth, async (req, res) => {
  const ac = await ownAircraft(req.params.id, req.uid), destId = int(req.query.dest);
  const error = await routeError(ac, req.uid, destId);
  if (error) return res.json({ error: error.key, params: error.params });
  const money = await one('SELECT debt, cash FROM users WHERE id = ?', [req.uid]);
  const fare = req.query.fare == null ? ac.fare_mult : Math.min(2, Math.max(0.5, Number(req.query.fare) || 1));
  const [now, next] = await Promise.all([loadEconomy(req.uid, money), loadEconomy(req.uid, money, { id: ac.id, dest_id: destId, fare_mult: fare })]);
  res.json({ route: next.routes[ac.id], delta: next.totals.profit - now.totals.profit });
});

app.post('/api/aircraft/:id/route', auth, async (req, res) => {
  const ac = await ownAircraft(req.params.id, req.uid);
  const fare = Number(req.body.fare_mult ?? ac.fare_mult);
  if (!(fare >= 0.5 && fare <= 2)) fail(400, 'Prisniveau skal være 50-200%');
  const destId = req.body.dest_id == null ? null : int(req.body.dest_id);
  const error = await routeError(ac, req.uid, destId);
  if (error) fail(400, error.key, error.params);
  await settle(req.uid);
  await q('UPDATE aircraft SET dest_id = ?, fare_mult = ? WHERE id = ?', [destId, fare, ac.id]);
  res.json({ ok: true });
});

app.post('/api/aircraft/:id/overhaul', auth, async (req, res) => {
  const ac = await ownAircraft(req.params.id, req.uid);
  await settle(req.uid);
  await tx(async c => {
    const ap = await lockOwned(c, ac.base_id, req.uid);
    const hc = hubStats(ap.layout, ap.site).count;
    if (!(hc.hangar_s || hc.hangar || hc.hangar_l)) fail(400, 'Eftersyn kræver en hangar på flyets base');
    await pay(c, req.uid, AIRCRAFT[ac.model].price * C.OVERHAUL_COST);
    await c.query('UPDATE aircraft SET cond = 100 WHERE id = ?', [ac.id]);
  });
  res.json({ ok: true });
});

app.post('/api/aircraft/:id/sell', auth, async (req, res) => {
  await settle(req.uid);
  await tx(async c => {
    const [ac] = await c.query('SELECT model, cond FROM aircraft WHERE id = ? AND user_id = ? FOR UPDATE', [int(req.params.id), req.uid]);
    if (!ac) fail(404, 'Ukendt fly');
    await c.query('DELETE FROM aircraft WHERE id = ?', [int(req.params.id)]);
    // Resale value drops with condition.
    await c.query('UPDATE users SET cash = cash + ? WHERE id = ?', [AIRCRAFT[ac.model].price * C.SELL_FACTOR * (0.5 + ac.cond / 200), req.uid]);
  });
  res.json({ ok: true });
});

// ---------- my page / settings ----------
const LANGS = ['da', 'en', 'de', 'es', 'fr', 'sv'];

app.post('/api/me', auth, async (req, res) => {
  const { company, color, bio, lang } = req.body, set = {};
  if (company !== undefined) {
    set.company = String(company).trim();
    if (set.company.length < 2 || set.company.length > 40) fail(400, 'Selskabsnavn: 2-40 tegn');
  }
  if (color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'Ugyldig farve');
    set.color = color.toLowerCase();
  }
  if (bio !== undefined) {
    set.bio = String(bio).trim();
    if (set.bio.length > 200) fail(400, 'Bio: maks 200 tegn');
  }
  if (lang !== undefined) {
    if (!LANGS.includes(lang)) fail(400, 'Ukendt sprog');
    set.lang = lang;
  }
  const keys = Object.keys(set);
  if (keys.length) await q(`UPDATE users SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(set), req.uid]);
  res.json({ ok: true });
});

app.post('/api/me/password', auth, async (req, res) => {
  const { current, next } = req.body;
  if (typeof next !== 'string' || next.length < 8 || next.length > 128) fail(400, 'Adgangskode: mindst 8 tegn');
  const u = await one('SELECT pass_hash FROM users WHERE id = ?', [req.uid]);
  if (typeof current !== 'string' || !(await checkPassword(current, u.pass_hash))) fail(400, 'Den nuværende adgangskode er forkert');
  await q('UPDATE users SET pass_hash = ? WHERE id = ?', [await hashPassword(next), req.uid]);
  // Sign out every other device.
  await q('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [req.uid, sha256(req.get('authorization').slice(7))]);
  res.json({ ok: true });
});

app.post('/api/me/ack-bankruptcy', auth, async (req, res) => {
  await q('UPDATE users SET bankrupt_notice = NULL WHERE id = ?', [req.uid]);
  res.json({ ok: true });
});

app.post('/api/me/logout-all', auth, async (req, res) => {
  await q('DELETE FROM sessions WHERE user_id = ? AND token <> ?', [req.uid, sha256(req.get('authorization').slice(7))]);
  res.json({ ok: true });
});

app.post('/api/me/delete', auth, async (req, res) => {
  const u = await one('SELECT pass_hash FROM users WHERE id = ?', [req.uid]);
  if (typeof req.body.password !== 'string' || !(await checkPassword(req.body.password, u.pass_hash))) fail(400, 'Den nuværende adgangskode er forkert');
  await q('DELETE FROM users WHERE id = ?', [req.uid]); // cascades to sessions, aircraft, airports, history, avatar
  res.json({ ok: true });
});

// Avatars: client crops/resizes to 256px; server only accepts PNG/JPEG/WebP verified by magic bytes.
const imageType = b =>
  b.length > 12 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' ? 'image/png'
  : b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
  : b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp'
  : null;

app.put('/api/me/avatar', auth, express.raw({ type: () => true, limit: '512kb' }), async (req, res) => {
  const mime = Buffer.isBuffer(req.body) && imageType(req.body);
  if (!mime) fail(400, 'Billedet skal være PNG, JPEG eller WebP');
  await q('REPLACE INTO avatars (user_id, mime, data) VALUES (?,?,?)', [req.uid, mime, req.body]);
  await q('UPDATE users SET avatar_ver = avatar_ver + 1 WHERE id = ?', [req.uid]);
  res.json({ ok: true });
});

app.post('/api/me/avatar/delete', auth, async (req, res) => {
  await q('DELETE FROM avatars WHERE user_id = ?', [req.uid]);
  await q('UPDATE users SET avatar_ver = 0 WHERE id = ?', [req.uid]);
  res.json({ ok: true });
});

app.get('/api/users/:id/avatar', async (req, res) => {
  const a = await one('SELECT mime, data FROM avatars WHERE user_id = ?', [int(req.params.id)]) || fail(404, 'Intet billede');
  // URL carries ?v=avatar_ver, so the image can be cached hard.
  res.set({ 'Content-Type': a.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(a.data);
});

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, key: err.key, params: err.params });
  if (err.status && err.expose !== false) return res.status(err.status).json({ error: err.message });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Findes allerede (navn eller lufthavn er taget)', key: 'Findes allerede (navn eller lufthavn er taget)' });
  console.error(err);
  res.status(500).json({ error: 'Serverfejl' });
});

await init();
app.listen(3000, () => console.log('Skyline backend kører på :3000'));
