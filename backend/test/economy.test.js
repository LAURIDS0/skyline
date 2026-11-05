import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/csv.js';
import { gatesFit, slotNeeds, slotsFit, hubStats, hasBuilding, computeEconomy, distanceKm, weatherFactor } from '../src/economy.js';
import { site, occupancy, place, countTypes, extSlot, removeRect, migrateLegacy, EXT_W } from '../src/layout.js';
import { AIRCRAFT, LICENSES, requirements, fuelPrice } from '../src/catalog.js';

const airports = {
  1: { lat: 55.526, lon: 8.553, type: 'medium_airport' },  // EBJ
  2: { lat: 55.618, lon: 12.656, type: 'large_airport' },  // CPH
};
const run = (aircraft, layout, extra = {}) =>
  computeEconomy({ uid: 7, aircraft, competitors: [], owned: { 1: layout }, airports, ownerOf: { 2: 9 }, fuel: 0.85, ...extra });

test('parseCsv handles quotes, commas and CRLF', () => {
  const rows = parseCsv('id,name\r\n1,"Kastrup, ""CPH"""\r\n2,Billund\n');
  assert.deepEqual(rows, [{ id: '1', name: 'Kastrup, "CPH"' }, { id: '2', name: 'Billund' }]);
});

test('distance CPH-LHR is about 980 km', () => {
  const km = distanceKm({ lat: 55.618, lon: 12.656 }, { lat: 51.47, lon: -0.454 });
  assert.ok(km > 950 && km < 1000, km);
});

test('site: main runway matches the real runway length, road along the bottom, both fixed', () => {
  const s = site('medium_airport', 2650);
  assert.equal(s.runway.w, 265);
  assert.ok(s.w >= s.runway.x + 265 + 3 * EXT_W);
  const layout = [], occ = occupancy(s, layout), counts = {};
  assert.equal(place(s, occ, layout, counts, 'gate_s', s.runway.x + 10, s.runway.y), 'Feltet er optaget');
  assert.equal(place(s, occ, layout, counts, 'path' in counts ? 'x' : 'grass', 5, s.h - 1), 'Feltet er optaget');
  assert.equal(place(s, occ, layout, counts, 'gate_s', s.w - 2, 20), 'Uden for området');
  assert.equal(place(s, occ, layout, counts, 'gate_s', 20, 20), null);
  assert.equal(place(s, occ, layout, counts, 'grass', 21, 21), 'Feltet er optaget');
  assert.equal(place(s, occ, layout, counts, 'tower', 40, 40), null);
  assert.equal(place(s, occ, layout, counts, 'tower', 50, 40), 'Maksimum nået for denne bygning');
});

test('rotation swaps the footprint; extensions pack onto the runway end', () => {
  const s = site('small_airport', 900), layout = [], occ = occupancy(s, layout), counts = {};
  assert.equal(place(s, occ, layout, counts, 'hangar', 20, 20, 1), null);   // 8 wide × 10 deep when rotated
  assert.equal(place(s, occ, layout, counts, 'grass', 27, 29), 'Feltet er optaget');
  assert.equal(place(s, occ, layout, counts, 'grass', 28, 20), null);
  for (let i = 0; i < 3; i++) { const e = extSlot(s, layout); assert.equal(place(s, occ, layout, counts, 'runway_ext', e.x, e.y), null); }
  assert.equal(extSlot(s, layout), null);
  const mid = layout.find(p => p.t === 'runway_ext' && p.x === s.runway.x + s.runway.w + EXT_W);
  const { keep } = removeRect(s, layout, mid.x, mid.y, mid.x, mid.y);
  assert.deepEqual(keep.filter(p => p.t === 'runway_ext').map(p => p.x), [s.runway.x + s.runway.w, s.runway.x + s.runway.w + EXT_W]);
});

test('legacy layouts migrate to the 10 m site; the starter runway becomes the main runway', () => {
  const old = [{ t: 'runway', x: 1, y: 0 }, { t: 'terminal_s', x: 0, y: 2 }, { t: 'gate_s', x: 3, y: 2 }, { t: 'runway_ext', x: 0, y: 5 }, { t: 'gate_l', x: 22, y: 13 }];
  const { layout, refund } = migrateLegacy('medium_airport', 1800, old);
  assert.deepEqual(countTypes(layout), { runway_ext: 1, terminal_s: 1, gate_s: 1 });
  assert.equal(refund, 1_200_000); // the wide-body gate in the bottom row would hit the road
});

test('gates and cargo stands are separate slot pools', () => {
  assert.ok(gatesFit({ S: 0, M: 1, L: 0 }, { S: 1, M: 0, L: 0 }));
  assert.ok(!gatesFit({ S: 2, M: 0, L: 0 }, { S: 0, M: 1, L: 0 }));
  const hub = hubStats([{ t: 'gate_s' }, { t: 'stand_s' }]);
  assert.ok(slotsFit(hub, slotNeeds([{ model: 'C208' }, { model: 'C08F' }])));
  assert.ok(!slotsFit(hub, slotNeeds([{ model: 'C08F' }, { model: 'C08F' }])));
});

test('requirements: jets need tower/fuel/fire, wide-bodies a hangar, freighters any cargo building', () => {
  assert.deepEqual(requirements(AIRCRAFT.C208), []);
  assert.deepEqual(requirements(AIRCRAFT.B77F), ['tower', 'fuel', 'fire', 'hangar', 'cargo']);
  assert.ok(hasBuilding(hubStats([{ t: 'cargo_hub' }]), 'cargo'));
  assert.ok(!hasBuilding(hubStats([{ t: 'shops' }]), 'cargo'));
  for (const m of Object.values(AIRCRAFT)) assert.ok(LICENSES[m.license], m.name);
});

test('starter Caravan: modest profit with terminal + gate, loss without terminal, loss when parked', () => {
  const base = [{ t: 'gate_s' }];
  const flying = [{ id: 1, model: 'C208', base_id: 1, dest_id: 2, fare_mult: 1, cond: 100 }];
  const good = run(flying, [...base, { t: 'terminal_s' }]);
  assert.ok(good.totals.profit > 0 && good.totals.profit < 200, String(good.totals.profit));
  assert.ok(good.feesTo[9] > 0);
  assert.ok(run(flying, base).totals.profit < 0);
  assert.ok(run([{ ...flying[0], dest_id: null }], base).totals.profit < 0);
});

test('worn aircraft cost more, grounded aircraft earn nothing, debt costs interest', () => {
  const layout = [{ t: 'gate_s' }, { t: 'terminal_s' }];
  const a = { id: 1, model: 'C208', base_id: 1, dest_id: 2, fare_mult: 1 };
  const fresh = run([{ ...a, cond: 100 }], layout).totals.profit;
  assert.ok(run([{ ...a, cond: 50 }], layout).totals.profit < fresh);
  assert.equal(run([{ ...a, cond: 10 }], layout).routes[1].grounded, true);
  assert.ok(run([{ ...a, cond: 100 }], layout, { debt: 1e6 }).totals.profit < fresh);
});

test('freighter earns cargo revenue only with a cargo terminal', () => {
  const layout = [{ t: 'stand_s' }, { t: 'cargo' }];
  const f = [{ id: 1, model: 'C08F', base_id: 1, dest_id: 2, fare_mult: 1, cond: 100 }];
  assert.ok(run(f, layout).totals.cargo > 0);
  assert.equal(run(f, layout.slice(0, 1)).totals.cargo, 0);
});

test('weather: frost without de-icing cuts capacity, with de-icing it does not', () => {
  assert.equal(weatherFactor({ temp: -3, wind: 10, code: 71 }, { deice: 0 }).factor, 0.6);
  assert.equal(weatherFactor({ temp: -3, wind: 10, code: 71 }, { deice: 1 }).factor, 1);
  assert.equal(weatherFactor({ temp: 10, wind: 80, code: 3 }, { deice: 1 }).factor, 0.7);
  const p = fuelPrice();
  assert.ok(p > 0.5 && p < 1.3, p);
});

test('negative cash costs overdraft interest at 5× the loan rate', () => {
  const layout = [{ t: 'gate_s' }, { t: 'terminal_s' }];
  const a = [{ id: 1, model: 'C208', base_id: 1, dest_id: 2, fare_mult: 1, cond: 100 }];
  const e = run(a, layout, { cash: -100_000, debt: 100_000 });
  assert.ok(Math.abs(e.totals.overdraft - 5 * e.totals.interest) < 1e-9);
  assert.equal(run(a, layout, { cash: 50_000 }).totals.overdraft, 0);
});

import { analyze } from '../src/analysis.js';

// A 6×4 room at (20,60) with walls, a door facing a path that runs down to the access road.
function roomLayout(s, { door = true, path = true, interior = true } = {}) {
  const L = [], occ = occupancy(s, L), c = {};
  const P = (t, x, y, r = 0, z = 0) => assert.equal(place(s, occ, L, c, t, x, y, r, z), null, `${t} ${x},${y}`);
  for (let y = 60; y < 64; y++) for (let x = 20; x < 26; x++) P('floor', x, y);
  for (let x = 20; x < 26; x++) { P('wall', x, 60, 0); if (!(door && x === 22)) P('wall', x, 64, 0); }
  for (let y = 60; y < 64; y++) { P('wall', 20, y, 1); P('wall', 26, y, 1); }
  if (door) P('door', 22, 64, 0);
  if (path) for (let y = 64; y < s.road.y; y++) P('path', 22, y);
  if (interior) { P('checkin', 21, 61); P('security', 23, 60); P('baggage', 21, 63); P('toilets', 24, 62); P('chairs', 20, 63); }
  return L;
}

test('custom terminal works only when closed, with a door to a path; capacity = the bottleneck', () => {
  const s = site('medium_airport', 1800);
  const ok = analyze(roomLayout(s), s);
  assert.equal(ok.custom.buildings, 1);
  assert.equal(ok.custom.caps.area, 24 * 2);
  assert.equal(ok.custom.cap, Math.min(48, 30, 100, 60, 80, 40));
  assert.equal(ok.custom.bottleneck, 'checkin');
  assert.equal(analyze(roomLayout(s, { door: false }), s).custom.cap, 0);
  assert.equal(analyze(roomLayout(s, { path: false }), s).custom.cap, 0);
  const outside = analyze(roomLayout(s, { interior: false }).concat({ t: 'kiosk', x: 40, y: 80 }), s);
  assert.equal(outside.working.at(-1), false);
});

test('gates only count when a taxiway links them to the runway', () => {
  const s = site('medium_airport', 1800), L = [], occ = occupancy(s, L), c = {};
  place(s, occ, L, c, 'gate_s', 30, 20);
  assert.equal(hubStats(L, s).gates.S, 0);
  for (let y = 8; y < 20; y++) place(s, occ, L, c, 'taxiway', 31, y);
  assert.equal(hubStats(L, s).gates.S, 1);
});

test('ticket price: cheaper fills more seats, expensive empties them (incumbent airlines compete)', () => {
  const layout = [{ t: 'gate_s' }, { t: 'terminal_s' }];
  const lf = fare => run([{ id: 1, model: 'C208', base_id: 1, dest_id: 2, fare_mult: fare, cond: 100 }], layout).routes[1].lf;
  assert.ok(lf(2) < lf(1.5) && lf(1.5) < lf(1.2), [lf(1.2), lf(1.5), lf(2)].join());
  assert.ok(lf(0.7) >= lf(1));
});

test('hangar places: aircraft beyond capacity pay more maintenance', () => {
  const a = [{ id: 1, model: 'C208', base_id: 1, dest_id: null, fare_mult: 1, cond: 100 }];
  const none = run(a, [{ t: 'gate_s' }]).totals.maintenance;
  const hang = run(a, [{ t: 'gate_s' }, { t: 'hangar_s' }]).totals.maintenance;
  assert.ok(none > hang * 1.5, `${none} vs ${hang}`);
});
