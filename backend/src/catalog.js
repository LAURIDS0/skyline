// Game rules and static data. Served to the frontend via /api/catalog so both sides share one source.

export const START_CASH = 8_000_000;
export const GAME_HOURS_PER_SEC = 1 / 60;   // clock + flights: 1 real second = 1 game minute
export const MONEY_HOURS_PER_SEC = 4;       // earnings: each real second credits 4 game hours of profit
export const OFFLINE_CAP_H = 4;             // offline earnings capped at 4 real hours
export const GAME_EPOCH = Date.UTC(2026, 10, 1);
export const TURNAROUND_H = 0.75;
export const MAINT_RATE = 0.000014;         // share of list price per hour
export const INSURANCE_RATE = 0.000004;     // share of list price per hour
export const OVERHEAD_PER_AIRCRAFT = 30;    // USD per hour: admin, IT, sales
export const INTEREST_RATE = 0.00001;       // per game hour on debt
export const OVERDRAFT_RATE = 0.00005;      // per game hour on negative cash (5× loan rate)
export const BANKRUPT_DEBT_PER_AIRPORT = 250_000; // overdraft beyond this × airports (min 1) = bankruptcy
export const ELASTICITY = 2.0;
export const NPC_SHARE = 0.8;               // incumbent airlines on every city pair, as a share of demand (at base fare)
export const MAX_LF = 0.92;
export const MAX_CARGO_LF = 0.85;
export const MIN_ROUTE_KM = 50;
export const WEAR_PER_FLIGHT_H = 1 / 200;   // condition % lost per flight hour
export const GROUNDED_BELOW = 20;           // condition % where the aviation authority grounds the aircraft
export const OVERHAUL_COST = 0.03;          // C-check: share of list price
export const SELL_FACTOR = 0.6;
export const RUNWAY_EXTENSION_M = 500;
export const HISTORY_EVERY_MS = 60_000;

export const AIRPORT_PRICE = { small_airport: 250_000, medium_airport: 1_500_000, large_airport: 25_000_000 };
export const AIRPORT_SIZE = { small_airport: 1, medium_airport: 4, large_airport: 12 };
export const DEFAULT_RUNWAY_M = { small_airport: 900, medium_airport: 1800, large_airport: 3000 };
// Pre-3D grid sizes (1 tile ~ 80 m); only used to migrate old layouts and as a minimum site size.
export const LEGACY_GRID = {
  small_airport: { w: 16, h: 10 },
  medium_airport: { w: 24, h: 14 },
  large_airport: { w: 32, h: 18 },
};
export const TILE_M = 10;                    // 3D builder: 1 tile = 10 m
export const SITE_H = { small_airport: 92, medium_airport: 124, large_airport: 156 };
export const MAX_ITEMS = 20000;               // per airport
export const MAX_BATCH = 2500;               // tiles per paint stroke
export const STARTER_LAYOUT = []; // the main runway and access road are implicit (see layout.js)

// Air Operator Certificates. xp = passengers + 10 × cargo tonnes flown (lifetime).
export const LICENSES = [
  { name: 'Regional', cost: 0, xp: 0, maxKm: 1500, desc: 'Turboprops og korte ruter' },
  { name: 'National', cost: 3_000_000, xp: 60_000, maxKm: 3500, desc: 'Regionaljets og ATR/Dash 8' },
  { name: 'Kontinental', cost: 25_000_000, xp: 1_000_000, maxKm: 7500, desc: 'Narrow-body jets som A320 og 737' },
  { name: 'Interkontinental', cost: 150_000_000, xp: 20_000_000, maxKm: 20000, desc: 'Wide-body og langdistance' },
];

// Real aircraft. Specs are rounded public figures; price ≈ list price (used/converted price for older types).
// cat: turboprop | rjet | narrow | wide | cargo. size = gate/stand class. payloadT = freighter payload.
const P = (name, cat, seats, rangeKm, speedKmh, fuelKgH, runwayM, price, license, size, jet = cat !== 'turboprop') =>
  ({ name, cat, seats, payloadT: 0, rangeKm, speedKmh, fuelKgH, runwayM, price, license, size, jet });
const F = (name, payloadT, rangeKm, speedKmh, fuelKgH, runwayM, price, license, size, jet = true) =>
  ({ name, cat: 'cargo', seats: 0, payloadT, rangeKm, speedKmh, fuelKgH, runwayM, price, license, size, jet });

export const AIRCRAFT = {
  BN2:  P('Britten-Norman BN-2 Islander', 'turboprop', 9, 1400, 273, 100, 400, 2_000_000, 0, 'S'),
  C208: P('Cessna 208B Grand Caravan', 'turboprop', 9, 1689, 340, 180, 700, 2_500_000, 0, 'S'),
  PC12: P('Pilatus PC-12 NGX', 'turboprop', 9, 3417, 528, 200, 800, 5_400_000, 0, 'S'),
  JS32: P('BAe Jetstream 32', 'turboprop', 19, 1260, 482, 320, 1300, 4_000_000, 0, 'S'),
  B190: P('Beechcraft 1900D', 'turboprop', 19, 1300, 518, 350, 1100, 6_000_000, 0, 'S'),
  L410: P('Let L-410 NG', 'turboprop', 19, 2500, 417, 300, 600, 6_500_000, 0, 'S'),
  DHC6: P('DHC-6 Twin Otter 400', 'turboprop', 19, 1480, 338, 290, 400, 7_000_000, 0, 'S'),
  D228: P('Dornier 228NG', 'turboprop', 19, 1100, 413, 330, 800, 7_500_000, 0, 'S'),
  E120: P('Embraer EMB 120 Brasilia', 'turboprop', 30, 1750, 552, 500, 1400, 6_500_000, 0, 'S'),
  SF34: P('Saab 340B', 'turboprop', 34, 1730, 522, 600, 1300, 8_000_000, 0, 'S'),
  AT46: P('ATR 42-600', 'turboprop', 48, 1326, 535, 600, 1100, 19_000_000, 1, 'S'),
  F50:  P('Fokker 50', 'turboprop', 56, 2055, 522, 700, 1300, 9_000_000, 1, 'M'),
  AT76: P('ATR 72-600', 'turboprop', 72, 1528, 510, 750, 1400, 26_000_000, 1, 'M'),
  DH8D: P('De Havilland Dash 8-400', 'turboprop', 78, 2040, 667, 1100, 1400, 32_000_000, 1, 'M'),
  CRJ2: P('Bombardier CRJ200', 'rjet', 50, 3000, 786, 1300, 1900, 15_000_000, 1, 'S'),
  CRJ9: P('Bombardier CRJ900', 'rjet', 90, 2876, 830, 1600, 1800, 48_000_000, 1, 'M'),
  E175: P('Embraer E175', 'rjet', 78, 3700, 829, 1800, 1650, 50_000_000, 1, 'M'),
  SU95: P('Sukhoi Superjet 100', 'rjet', 98, 3000, 828, 1700, 1750, 36_000_000, 1, 'M'),
  E190: P('Embraer E190', 'rjet', 100, 4500, 829, 1900, 1700, 52_000_000, 1, 'M'),
  F100: P('Fokker 100', 'rjet', 100, 3170, 845, 2100, 1700, 10_000_000, 1, 'M'),
  E295: P('Embraer E195-E2', 'narrow', 132, 4800, 833, 2100, 1900, 60_000_000, 2, 'M'),
  BCS1: P('Airbus A220-100', 'narrow', 120, 6390, 829, 2000, 1500, 81_000_000, 2, 'M'),
  BCS3: P('Airbus A220-300', 'narrow', 140, 6300, 829, 2200, 1900, 91_000_000, 2, 'M'),
  B737: P('Boeing 737-700', 'narrow', 140, 6370, 842, 2400, 2000, 89_000_000, 2, 'M'),
  A19N: P('Airbus A319neo', 'narrow', 140, 6950, 833, 2300, 2000, 101_000_000, 2, 'M'),
  C919: P('COMAC C919', 'narrow', 168, 4075, 834, 2500, 2200, 99_000_000, 2, 'M'),
  B738: P('Boeing 737-800', 'narrow', 189, 5400, 842, 2500, 2300, 106_000_000, 2, 'M'),
  A20N: P('Airbus A320neo', 'narrow', 180, 6300, 833, 2400, 2100, 111_000_000, 2, 'M'),
  B38M: P('Boeing 737 MAX 8', 'narrow', 178, 6570, 839, 2300, 2500, 121_000_000, 2, 'M'),
  B3XM: P('Boeing 737 MAX 10', 'narrow', 204, 5740, 839, 2600, 2500, 135_000_000, 2, 'M'),
  B752: P('Boeing 757-200', 'narrow', 200, 7250, 850, 3300, 2100, 80_000_000, 2, 'M'),
  A21N: P('Airbus A321neo', 'narrow', 220, 7400, 833, 2700, 2200, 129_000_000, 2, 'M'),
  A21X: P('Airbus A321XLR', 'narrow', 220, 8700, 833, 2700, 2500, 142_000_000, 3, 'M'),
  B763: P('Boeing 767-300ER', 'wide', 269, 11000, 851, 4800, 2700, 220_000_000, 3, 'L'),
  B788: P('Boeing 787-8', 'wide', 248, 13530, 903, 5000, 2600, 248_000_000, 3, 'L'),
  A333: P('Airbus A330-300', 'wide', 300, 11750, 871, 6000, 2700, 264_000_000, 3, 'L'),
  B789: P('Boeing 787-9', 'wide', 290, 14000, 903, 5600, 2900, 292_000_000, 3, 'L'),
  A339: P('Airbus A330-900', 'wide', 287, 13300, 871, 5700, 2800, 296_000_000, 3, 'L'),
  A359: P('Airbus A350-900', 'wide', 315, 15000, 903, 5800, 2600, 317_000_000, 3, 'L'),
  B78X: P('Boeing 787-10', 'wide', 330, 11750, 903, 6000, 2900, 338_000_000, 3, 'L'),
  A35K: P('Airbus A350-1000', 'wide', 369, 16100, 903, 6800, 2750, 366_000_000, 3, 'L'),
  B77W: P('Boeing 777-300ER', 'wide', 396, 13650, 905, 7500, 3100, 375_000_000, 3, 'L'),
  B748: P('Boeing 747-8I', 'wide', 410, 14320, 917, 10500, 3100, 418_000_000, 3, 'L'),
  B779: P('Boeing 777-9', 'wide', 426, 13500, 905, 7700, 3050, 442_000_000, 3, 'L'),
  A388: P('Airbus A380-800', 'wide', 555, 15200, 903, 11000, 3000, 445_000_000, 3, 'L'),
  C08F: F('Cessna 208B Super Cargomaster', 1.6, 1689, 340, 180, 750, 2_600_000, 0, 'S', false),
  AT7F: F('ATR 72-600F', 9, 1530, 510, 750, 1400, 30_000_000, 1, 'S', false),
  B34F: F('Boeing 737-400SF', 17, 3300, 794, 2600, 2500, 12_000_000, 1, 'M'),
  B38F: F('Boeing 737-800BCF', 23, 3750, 842, 2500, 2300, 30_000_000, 2, 'M'),
  B75F: F('Boeing 757-200PCF', 39, 5800, 850, 3300, 2100, 28_000_000, 2, 'M'),
  B76F: F('Boeing 767-300F', 52, 6025, 851, 4800, 2700, 220_000_000, 3, 'L'),
  A33F: F('Airbus A330-200F', 65, 7400, 871, 5800, 2400, 240_000_000, 3, 'L'),
  B77F: F('Boeing 777F', 102, 9070, 896, 7500, 2800, 352_000_000, 3, 'L'),
  B48F: F('Boeing 747-8F', 134, 8130, 908, 10500, 3100, 419_000_000, 3, 'L'),
  A124: F('Antonov An-124-100', 150, 4800, 800, 12000, 3000, 200_000_000, 3, 'L'),
};

export const CATEGORIES = { turboprop: 'Turboprop', rjet: 'Regionaljet', narrow: 'Narrow-body', wide: 'Wide-body', cargo: 'Fragtfly' };

// Airport items. w/h = footprint in 10 m tiles, upkeep = USD per game hour.
// layer: ground (paving/floors), object (default) or edge (walls/doors on tile edges).
// access: land = needs a road/path link to the access road, air = needs a taxiway/apron link to a runway, both.
// indoor: only works inside a closed building (floor + walls + a door). levels: may be built on upper floors.
// paint: drag to fill an area. rot: can be rotated with R. auto: placed by the server.
// Custom terminals: capacity = the smallest of floor area, check-in, security, baggage, toilets and seats (see analysis.js).
const I = (group, name, w, h, cost, upkeep, icon, color, effect, desc, extra = {}) => ({ group, name, w, h, cost, upkeep, icon, color, effect, desc, layer: 'object', ...extra });
const G = { layer: 'ground', paint: true };
const IN = { indoor: true, levels: true };
export const BUILDINGS = {
  // Infrastructure
  runway:     I('Infrastruktur', 'Ekstra landingsbane', 150, 5, 2_500_000, 120, 'fa-road', '#2b2e35', { movements: 12 }, '+12 flybevægelser/t', { rot: true }),
  runway_ext: I('Infrastruktur', 'Baneforlængelse', 50, 5, 2_500_000, 30, 'fa-ruler-horizontal', '#2b2e35', { runwayExt: 1 }, `+${RUNWAY_EXTENSION_M} m banelængde`, { max: 3, auto: true }),
  taxiway:    I('Infrastruktur', 'Taxivej', 1, 1, 2_000, 0.3, 'fa-grip-lines', '#3a3e46', { movements: 0.02 }, 'Forbinder gates og hangarer med banen · +0,02 bevægelser/t', G),
  apron:      I('Infrastruktur', 'Forplads', 1, 1, 1_200, 0.1, 'fa-square', '#7b808a', {}, 'Forbinder gates og hangarer med taxivejen', G),
  road:       I('Infrastruktur', 'Vej', 1, 1, 800, 0.1, 'fa-road', '#3d4048', {}, 'Giver vejadgang fra tilkørselsvejen', G),
  path:       I('Infrastruktur', 'Fortov', 1, 1, 300, 0.05, 'fa-shoe-prints', '#c9bfa8', {}, 'Gangsti: forbinder døre med vejnettet', G),
  tower:      I('Infrastruktur', 'Kontroltårn', 2, 2, 600_000, 60, 'fa-tower-observation', '#c9ced8', { movementMult: 0.5 }, '+50% banekapacitet · krav for jetfly', { max: 1 }),
  ils:        I('Infrastruktur', 'ILS-anlæg', 4, 1, 900_000, 50, 'fa-satellite-dish', '#d9dde4', { movementMult: 0.25 }, '+25% banekapacitet (instrumentlanding)', { max: 1, rot: true, access: 'air' }),
  weather:    I('Infrastruktur', 'Vejrstation', 1, 1, 120_000, 8, 'fa-wind', '#f08a3c', { stormShield: 1 }, 'Halverer tabet af kapacitet i storm', { max: 1 }),
  fire:       I('Infrastruktur', 'Brandstation', 4, 3, 450_000, 45, 'fa-fire-extinguisher', '#c23b32', {}, 'Krav for jetfly · skal kunne nå forpladsen', { max: 1, rot: true, access: 'air' }),
  fuel:       I('Infrastruktur', 'Brændstofdepot', 4, 3, 500_000, 40, 'fa-gas-pump', '#d7dbe2', { fuelDiscount: 0.06 }, '−6% brændstof · krav for jetfly', { max: 3, rot: true, access: 'air' }),
  deice:      I('Infrastruktur', 'Afisningsplads', 6, 6, 700_000, 35, 'fa-snowflake', '#4c86a8', { deice: 1 }, 'Fuld kapacitet i frost og sne', { max: 1, access: 'air' }),
  hangar_s:   I('Infrastruktur', 'Lille hangar', 8, 6, 600_000, 40, 'fa-warehouse', '#9aa3b2', { hangar: 4, maintDiscount: 0.03 }, '4 hangarpladser · −3% vedligehold', { max: 6, rot: true, access: 'air' }),
  hangar:     I('Infrastruktur', 'Hangar', 10, 8, 1_500_000, 90, 'fa-warehouse', '#8a93a3', { hangar: 8, maintDiscount: 0.05 }, '8 hangarpladser · −5% vedligehold · krav for wide-body', { max: 6, rot: true, access: 'air' }),
  hangar_l:   I('Infrastruktur', 'Stor hangar', 16, 12, 4_500_000, 220, 'fa-warehouse', '#7d8696', { hangar: 20, maintDiscount: 0.08 }, '20 hangarpladser · −8% vedligehold · krav for wide-body', { max: 4, rot: true, access: 'air' }),
  // Passengers (prefab terminals are complete buildings; everything else builds your own)
  terminal_s: I('Passagerer', 'Regional terminal (færdigbygget)', 8, 6, 250_000, 30, 'fa-building', '#9fc4e8', { pax: 60 }, '+60 passagerer/t · kræver vejadgang', { rot: true, access: 'land' }),
  terminal_l: I('Passagerer', 'Terminal (færdigbygget)', 20, 10, 2_000_000, 180, 'fa-building-columns', '#8bb8e6', { pax: 400 }, '+400 passagerer/t · kræver vejadgang', { rot: true, access: 'land' }),
  checkin:    I('Passagerer', 'Check-in skranke', 2, 1, 40_000, 4, 'fa-id-card', '#3d6fd6', { checkin: 1 }, '30 passagerer/t i egen terminal', { max: 80, rot: true, ...IN }),
  security:   I('Passagerer', 'Sikkerhedskontrol', 3, 2, 350_000, 50, 'fa-shield-halved', '#5a6f9e', { security: 1 }, '100 passagerer/t i egen terminal', { max: 16, rot: true, ...IN }),
  baggage:    I('Passagerer', 'Bagagebånd', 3, 1, 60_000, 5, 'fa-suitcase-rolling', '#555c6a', { baggage: 1 }, '60 passagerer/t i egen terminal', { max: 30, rot: true, ...IN }),
  toilets:    I('Passagerer', 'Toiletter', 2, 2, 50_000, 6, 'fa-restroom', '#5aa0b5', { toilets: 1, comfort: 1 }, '80 passagerer/t i egen terminal · +1 komfort', { max: 30, ...IN }),
  chairs:     I('Passagerer', 'Stolerække', 1, 1, 1_500, 0.1, 'fa-chair', '#4466c4', { seats: 1, comfort: 0.3 }, '40 passagerer/t i egen terminal (ventepladser)', { paint: true, rot: true, ...IN }),
  info:       I('Passagerer', 'Informationsskranke', 1, 1, 15_000, 2, 'fa-circle-info', '#3d8fd6', { comfort: 2 }, '+2 komfort (indendørs)', { max: 10, rot: true, ...IN }),
  screen:     I('Passagerer', 'Afgangstavle', 1, 1, 12_000, 1, 'fa-display', '#1b2a4a', { comfort: 1.5 }, '+1,5 komfort (indendørs)', { max: 20, rot: true, ...IN }),
  lounge:     I('Passagerer', 'Lounge', 3, 3, 300_000, 25, 'fa-couch', '#8a5ab0', { demand: 0.04 }, '+4% efterspørgsel (indendørs)', { max: 4, ...IN }),
  gate_s:     I('Passagerer', 'Gate · lille', 4, 4, 80_000, 8, 'fa-door-open', '#1f9e8f', { gate: 'S' }, 'Fly i klasse S · skal kunne nå banen', { rot: true, access: 'air' }),
  gate_m:     I('Passagerer', 'Gate · narrow-body', 6, 6, 400_000, 30, 'fa-door-open', '#178a7c', { gate: 'M' }, 'Fly i klasse S og M · skal kunne nå banen', { rot: true, access: 'air' }),
  gate_l:     I('Passagerer', 'Gate · wide-body', 8, 8, 1_200_000, 80, 'fa-door-open', '#0f6f63', { gate: 'L' }, 'Alle fly · skal kunne nå banen', { rot: true, access: 'air' }),
  // Building parts
  floor:      I('Bygning', 'Gulv', 1, 1, 500, 0.05, 'fa-border-all', '#e3ddd0', { area: 1 }, 'Indendørs areal: 2 passagerer/t pr. felt', { ...G, levels: true }),
  wall:       I('Bygning', 'Væg', 1, 1, 1_500, 0.1, 'fa-grip-lines-vertical', '#ece8df', {}, 'Lukker bygningen · træk en linje, Shift = rum', { layer: 'edge', paint: true, levels: true }),
  glasswall:  I('Bygning', 'Glasfacade', 1, 1, 4_000, 0.2, 'fa-table-columns', '#9fd0ee', { comfort: 0.05 }, 'Lukker bygningen og giver lys', { layer: 'edge', paint: true, levels: true }),
  door:       I('Bygning', 'Dør', 1, 1, 8_000, 0.3, 'fa-door-closed', '#6b7a8f', {}, 'Indgang · skal vende ud mod fortov eller vej', { layer: 'edge', paint: true, levels: true }),
  stairs:     I('Bygning', 'Trappe', 1, 2, 20_000, 1, 'fa-stairs', '#b8b2a6', { lift: 30 }, 'Forbinder etagen ovenover · 30 felter areal', { rot: true, ...IN }),
  escalator:  I('Bygning', 'Rulletrappe', 1, 3, 120_000, 8, 'fa-arrow-trend-up', '#7a8494', { lift: 120 }, 'Forbinder etagen ovenover · 120 felter areal', { rot: true, ...IN }),
  elevator:   I('Bygning', 'Elevator', 1, 1, 80_000, 6, 'fa-elevator', '#8a93a3', { lift: 60 }, 'Forbinder etagen ovenover · 60 felter areal', { ...IN }),
  planter:    I('Bygning', 'Plantekasse', 1, 1, 1_200, 0.1, 'fa-seedling', '#4c8a44', { comfort: 0.5 }, '+0,5 komfort (indendørs)', { paint: true, ...IN }),
  // Cargo
  cargo:      I('Fragt', 'Fragtterminal', 10, 6, 900_000, 70, 'fa-boxes-stacked', '#b8893b', { cargoT: 15 }, '+15 t fragt/t · kræver vej og forplads', { rot: true, access: 'both' }),
  cargo_hub:  I('Fragt', 'Fragtcenter', 16, 10, 6_000_000, 350, 'fa-truck-ramp-box', '#c29a3e', { cargoT: 120 }, '+120 t fragt/t · kræver vej og forplads', { rot: true, access: 'both' }),
  stand_s:    I('Fragt', 'Fragtstand · lille', 4, 4, 70_000, 6, 'fa-box', '#d9a62e', { stand: 'S' }, 'Fragtfly i klasse S · skal kunne nå banen', { rot: true, access: 'air' }),
  stand_m:    I('Fragt', 'Fragtstand · mellem', 6, 6, 350_000, 25, 'fa-box', '#c99422', { stand: 'M' }, 'Fragtfly i klasse S og M · skal kunne nå banen', { rot: true, access: 'air' }),
  stand_l:    I('Fragt', 'Fragtstand · stor', 8, 8, 1_000_000, 70, 'fa-box', '#b88218', { stand: 'L' }, 'Alle fragtfly · skal kunne nå banen', { rot: true, access: 'air' }),
  // Commercial
  shops:      I('Kommercielt', 'Butikker', 3, 2, 200_000, 20, 'fa-bag-shopping', '#e0a43a', { perPax: 1.5 }, '+$1,5 pr. passager (indendørs)', { max: 12, rot: true, ...IN }),
  food:       I('Kommercielt', 'Restaurant', 3, 3, 250_000, 25, 'fa-utensils', '#d9822b', { perPax: 1.2, comfort: 1 }, '+$1,2 pr. passager (indendørs)', { max: 10, ...IN }),
  cafe:       I('Kommercielt', 'Café', 2, 2, 150_000, 12, 'fa-mug-hot', '#a8693a', { perPax: 0.5, comfort: 1 }, '+$0,5 pr. passager (indendørs)', { max: 10, ...IN }),
  kiosk:      I('Kommercielt', 'Kiosk', 1, 1, 50_000, 4, 'fa-newspaper', '#e06a3a', { perPax: 0.2 }, '+$0,2 pr. passager (indendørs)', { max: 20, rot: true, ...IN }),
  parking:    I('Kommercielt', 'Parkering', 10, 8, 150_000, 10, 'fa-square-parking', '#4a5468', { perPax: 1 }, '+$1 pr. passager · kræver vejadgang', { max: 6, rot: true, access: 'land' }),
  busstop:    I('Kommercielt', 'Busstoppested', 3, 1, 40_000, 3, 'fa-bus', '#3d8f5a', { demand: 0.01 }, '+1% efterspørgsel · kræver vejadgang', { max: 4, rot: true, access: 'land' }),
  hotel:      I('Kommercielt', 'Lufthavnshotel', 6, 6, 1_200_000, 90, 'fa-hotel', '#c98b5a', { perPax: 2, demand: 0.03 }, '+$2/pax, +3% efterspørgsel · kræver vejadgang', { max: 2, access: 'land' }),
  // Outdoor decor (comfort: every point = +0.1% demand, max +8%)
  grass:      I('Natur og pynt', 'Græs', 1, 1, 200, 0.02, 'fa-seedling', '#6aa04a', { comfort: 0.1 }, '+0,1 komfort', G),
  flowers:    I('Natur og pynt', 'Blomsterbed', 1, 1, 800, 0.1, 'fa-spa', '#e05a8a', { comfort: 0.5 }, '+0,5 komfort', { paint: true }),
  bush:       I('Natur og pynt', 'Busk', 1, 1, 1_000, 0.1, 'fa-leaf', '#3f8a3a', { comfort: 0.5 }, '+0,5 komfort', { paint: true }),
  tree:       I('Natur og pynt', 'Træ', 1, 1, 2_500, 0.2, 'fa-tree', '#2f7a34', { comfort: 1 }, '+1 komfort', { paint: true }),
  bench:      I('Natur og pynt', 'Bænk', 1, 1, 2_000, 0.1, 'fa-couch', '#8a6a4a', { comfort: 1 }, '+1 komfort', { paint: true, rot: true }),
  lamp:       I('Natur og pynt', 'Lygtepæl', 1, 1, 1_200, 0.1, 'fa-lightbulb', '#f2d16b', { comfort: 0.3 }, '+0,3 komfort', { paint: true }),
  flag:       I('Natur og pynt', 'Flagstang', 1, 1, 3_000, 0.1, 'fa-flag', '#d94a4a', { comfort: 0.5 }, '+0,5 komfort', { paint: true }),
  statue:     I('Natur og pynt', 'Skulptur', 1, 1, 25_000, 1, 'fa-monument', '#b7b2a8', { comfort: 2 }, '+2 komfort', { max: 20 }),
  fountain:   I('Natur og pynt', 'Springvand', 2, 2, 60_000, 3, 'fa-water', '#5aa8d9', { comfort: 5 }, '+5 komfort', { max: 10 }),
};
export const LEVELS = 4;                      // ground floor + 3 upper floors
// Throughput per item in a custom terminal (passengers per game hour).
export const TERMINAL_RATES = { area: 2, checkin: 30, security: 100, baggage: 60, toilets: 80, seats: 40 };
export const HANGAR_SLOTS = { S: 1, M: 2, L: 4 }; // hangar places used per aircraft by size

// What a base airport must have before an aircraft can be stationed there.
export function requirements(m) {
  const req = [];
  if (m.jet) req.push('tower', 'fuel', 'fire');
  if (m.size === 'L') req.push('hangar');
  if (m.cat === 'cargo') req.push('cargo');
  return req;
}

// Jet fuel price (USD/kg) drifts with real time: slow cycle + weekly swing, ±~25%.
export function fuelPrice(ms = Date.now()) {
  const d = ms / 86_400_000;
  return +(0.85 * (1 + 0.15 * Math.sin(d / 9) + 0.08 * Math.sin(d / 2.3 + 1) + 0.04 * Math.sin(d * 1.7))).toFixed(3);
}
