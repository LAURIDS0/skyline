import { analyze } from './analysis.js';
import {
  AIRCRAFT, BUILDINGS, AIRPORT_SIZE, TURNAROUND_H, MAINT_RATE, INSURANCE_RATE, OVERHEAD_PER_AIRCRAFT, INTEREST_RATE, OVERDRAFT_RATE,
  ELASTICITY, MAX_LF, MAX_CARGO_LF, GROUNDED_BELOW, NPC_SHARE, HANGAR_SLOTS,
} from './catalog.js';

export function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export const legsPerHour = (m, km) => 1 / (km / m.speedKmh + TURNAROUND_H);
export const baseFare = km => 45 + 0.09 * km;           // USD per passenger
export const cargoRate = km => 120 + 0.35 * km;         // USD per tonne
export const bellyT = m => (m.cat === 'cargo' ? m.payloadT : m.size === 'L' ? m.seats * 0.06 : m.size === 'M' ? m.seats * 0.012 : 0);
// Commuters (≤19 seats) fly with one pilot and no cabin crew.
export const crewCost = m => (m.seats && m.seats <= 19 ? 95 : 190 + Math.ceil(m.seats / 50) * 35);
export const landingFee = m => 40 + 4 * m.seats + 8 * m.payloadT;
export const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const distFactor = km => (km < 150 ? 0.3 : 1 / (1 + km / 4000));
// Per game hour, per direction, before price and competition.
export const paxDemand = (a, b, km) => 4 * AIRPORT_SIZE[a.type] * AIRPORT_SIZE[b.type] * distFactor(km);
export const cargoDemand = (a, b, km) => 0.25 * AIRPORT_SIZE[a.type] * AIRPORT_SIZE[b.type] * distFactor(km);

const CUSTOM_ONLY = ['checkin', 'security', 'baggage', 'toilets', 'seats', 'area', 'lift'];
const SUMMED = ['pax', 'cargoT', 'movements', 'movementMult', 'fuelDiscount', 'maintDiscount', 'demand', 'perPax', 'runwayExt', 'deice', 'comfort', 'hangar', 'stormShield'];
// Hub capabilities from the items that actually work (see analysis.js). Without a site plan every item counts.
export function hubStats(layout, site) {
  const a = site ? analyze(layout, site) : null;
  // movements starts at 12: every airport has its fixed main runway.
  const s = { gates: { S: 0, M: 0, L: 0 }, stands: { S: 0, M: 0, L: 0 }, count: {}, built: {}, pax: 0, cargoT: 0, movements: 12, movementMult: 1, comfort: 0,
    fuelDiscount: 0, maintDiscount: 0, demand: 0, perPax: 0, runwayExt: 0, deice: 0, hangar: 0, stormShield: 0, upkeep: 0 };
  layout.forEach((p, i) => {
    const { effect, upkeep } = BUILDINGS[p.t];
    s.upkeep += upkeep;
    s.built[p.t] = (s.built[p.t] || 0) + 1;
    if (a && !a.working[i] && p.t !== 'runway_ext') return;
    s.count[p.t] = (s.count[p.t] || 0) + 1;
    if (effect.gate) s.gates[effect.gate]++;
    if (effect.stand) s.stands[effect.stand]++;
    for (const k of SUMMED) if (!CUSTOM_ONLY.includes(k)) s[k] += effect[k] || 0;
  });
  s.prefabPax = s.pax;
  s.custom = a?.custom ?? null;
  s.pax += s.custom?.cap || 0;
  s.demand += Math.min(0.08, s.comfort * 0.001);
  s.issues = a?.issues ?? {};
  s.why = a?.why ?? [];
  return s;
}

// Big aircraft need big slots; small aircraft may use any larger slot.
export const gatesFit = (g, n) =>
  n.L <= g.L && n.L + n.M <= g.L + g.M && n.L + n.M + n.S <= g.L + g.M + g.S;

export function slotNeeds(aircraft) {
  const n = { gate: { S: 0, M: 0, L: 0 }, stand: { S: 0, M: 0, L: 0 } };
  for (const a of aircraft) { const m = AIRCRAFT[a.model]; n[m.cat === 'cargo' ? 'stand' : 'gate'][m.size]++; }
  return n;
}
// Any cargo building satisfies 'cargo'; wide-bodies need a regular or large hangar.
export const hasBuilding = (hub, key) =>
  key === 'cargo' ? hub.cargoT > 0 : key === 'hangar' ? !!(hub.count.hangar || hub.count.hangar_l) : !!hub.count[key];
export const hangarNeed = aircraft => aircraft.reduce((n, a) => n + HANGAR_SLOTS[AIRCRAFT[a.model].size], 0);
export const slotsFit = (hub, n) => gatesFit(hub.gates, n.gate) && gatesFit(hub.stands, n.stand);

// Live weather (Open-Meteo) at a hub cuts runway capacity.
export function weatherFactor(w, hub) {
  if (!w) return { factor: 1, note: null };
  if (w.code >= 95 || w.wind >= 60) return hub.stormShield ? { factor: 0.85, note: 'Storm: −15% banekapacitet (vejrstation)' } : { factor: 0.7, note: 'Storm: −30% banekapacitet' };
  const icy = w.temp <= 0 || (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86 || [56, 57, 66, 67].includes(w.code);
  if (icy && !hub.deice) return { factor: 0.6, note: 'Frost/sne uden afisning: −40% banekapacitet' };
  return { factor: 1, note: null };
}

/**
 * Hourly economy for one player.
 * aircraft: player's planes {id, model, base_id, dest_id, fare_mult, cond}
 * competitors: other players' routed planes on the same city pairs
 * owned: {airportId: layout}, airports: {id: {lat, lon, type}}, ownerOf: {airportId: userId}
 * weather: {airportId: {temp, wind, code}}, fuel: USD/kg, debt: bank loans in USD, cash: may be negative (overdraft)
 */
export function computeEconomy({ uid, aircraft, competitors, owned, sites = {}, airports, ownerOf, weather = {}, fuel, debt = 0, cash = 0 }) {
  const hubs = {};
  for (const [id, layout] of Object.entries(owned)) {
    const h = hubs[id] = { ...hubStats(layout, sites[id]), paxUsed: 0, cargoUsed: 0, movUsed: 0 };
    const based = aircraft.filter(a => String(a.base_id) === id);
    h.hangarUsed = hangarNeed(based);
    h.hangarShort = h.hangarUsed ? Math.max(0, h.hangarUsed - h.hangar) / h.hangarUsed : 0;
  }

  const flying = a => a.dest_id && (a.cond ?? 100) >= GROUNDED_BELOW;
  // Every city pair also has incumbent (NPC) airlines at the base fare. Passengers split by capacity × appeal,
  // where appeal = price^−elasticity × hub quality, so a cheap fare fills seats and an expensive one empties them.
  const appeal = a => (a.fare_mult ?? 1) ** -ELASTICITY * (1 + (hubs[a.base_id]?.demand || 0));
  const capPax = {}, capCargo = {};
  for (const a of [...aircraft.filter(flying), ...competitors]) {
    const m = AIRCRAFT[a.model], k = pairKey(a.base_id, a.dest_id);
    const legs = legsPerHour(m, distanceKm(airports[a.base_id], airports[a.dest_id]));
    capPax[k] = (capPax[k] || 0) + m.seats * legs / 2 * appeal(a);
    capCargo[k] = (capCargo[k] || 0) + bellyT(m) * legs / 2 * appeal(a);
  }

  const routes = aircraft.map(a => {
    const m = AIRCRAFT[a.model], hub = hubs[a.base_id];
    if (!flying(a)) return { a, m, hub, idle: true };
    const from = airports[a.base_id], to = airports[a.dest_id], k = pairKey(a.base_id, a.dest_id);
    const km = distanceKm(from, to), legs = legsPerHour(m, km);
    const D = paxDemand(from, to, km), DC = cargoDemand(from, to, km), ap = appeal(a);
    const lf = m.seats ? Math.min(MAX_LF, D * ap / (capPax[k] + NPC_SHARE * D)) : 0;
    const belly = hub.cargoT > 0 ? bellyT(m) : 0;
    const cargoLf = belly ? Math.min(MAX_CARGO_LF, DC * ap / (capCargo[k] + NPC_SHARE * DC)) : 0;
    hub.paxUsed += legs * m.seats * lf;
    hub.cargoUsed += legs * belly * cargoLf;
    hub.movUsed += legs;
    return { a, m, hub, km, legs, lf, belly, cargoLf };
  });

  // shortcut: hub limits only count this player's own based flights, not other players' arrivals.
  for (const [id, h] of Object.entries(hubs)) {
    const wx = weatherFactor(weather[id], h);
    h.weather = weather[id] || null;
    h.weatherNote = wx.note;
    h.movCap = h.movements * h.movementMult * wx.factor;
    h.movFactor = Math.min(1, h.movUsed ? h.movCap / h.movUsed : 1);
    h.paxFactor = Math.min(1, h.paxUsed ? h.pax / (h.paxUsed * h.movFactor) : 1);
    h.cargoFactor = Math.min(1, h.cargoUsed ? h.cargoT / (h.cargoUsed * h.movFactor) : 1);
  }

  const totals = { revenue: 0, cargo: 0, ancillary: 0, fuel: 0, maintenance: 0, insurance: 0, crew: 0, fees: 0, overhead: 0, upkeep: 0, interest: 0, overdraft: 0, pax: 0, cargoT: 0 };
  const feesTo = {}, out = {};
  for (const r of routes) {
    const { a, m, hub } = r;
    const cond = a.cond ?? 100;
    const fixed = {
      // No hangar place: maintenance is bought in at +60%.
      maintenance: m.price * MAINT_RATE * (1 - hub.maintDiscount) * (1 + (100 - cond) / 40) * (r.idle ? 0.3 : 1) * (1 + 0.6 * hub.hangarShort),
      insurance: m.price * INSURANCE_RATE,
      crew: crewCost(m),
      overhead: OVERHEAD_PER_AIRCRAFT,
    };
    const fixedSum = fixed.maintenance + fixed.insurance + fixed.crew + fixed.overhead;
    Object.entries(fixed).forEach(([k, v]) => (totals[k] += v));
    if (r.idle) {
      out[a.id] = { idle: true, grounded: !!a.dest_id, profit: -fixedSum, flightH: 0 };
      continue;
    }
    const f = hub.movFactor;
    const pax = r.legs * m.seats * r.lf * f * hub.paxFactor;
    const cargoT = r.legs * r.belly * r.cargoLf * f * hub.cargoFactor;
    const flightH = r.legs * r.km / m.speedKmh * f;
    const v = {
      revenue: pax * baseFare(r.km) * a.fare_mult,
      cargo: cargoT * cargoRate(r.km) * a.fare_mult,
      ancillary: pax * hub.perPax,
      fuel: m.fuelKgH * fuel * flightH * (1 - hub.fuelDiscount),
      fees: ownerOf[a.dest_id] === uid ? 0 : landingFee(m) * r.legs / 2 * f,
    };
    const owner = ownerOf[a.dest_id];
    if (owner && owner !== uid) feesTo[owner] = (feesTo[owner] || 0) + v.fees;
    Object.entries(v).forEach(([k, x]) => (totals[k] += x));
    totals.pax += pax;
    totals.cargoT += cargoT;
    out[a.id] = {
      km: r.km, legs: r.legs, lf: r.lf * hub.paxFactor, cargoLf: r.cargoLf * hub.cargoFactor, pax, cargoT, flightH,
      fare: baseFare(r.km) * a.fare_mult, cargoFare: cargoRate(r.km) * a.fare_mult,
      profit: v.revenue + v.cargo + v.ancillary - v.fuel - v.fees - fixedSum,
    };
  }
  for (const h of Object.values(hubs)) totals.upkeep += h.upkeep;
  totals.interest = debt * INTEREST_RATE;
  totals.overdraft = Math.max(0, -cash) * OVERDRAFT_RATE;
  totals.profit = totals.revenue + totals.cargo + totals.ancillary
    - totals.fuel - totals.maintenance - totals.insurance - totals.crew - totals.fees - totals.overhead - totals.upkeep - totals.interest - totals.overdraft;
  return { totals, routes: out, hubs, feesTo };
}
