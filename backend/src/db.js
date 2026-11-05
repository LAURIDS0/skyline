import mariadb from 'mariadb';
import { parseCsv } from './csv.js';
import { DEFAULT_RUNWAY_M } from './catalog.js';
import { migrateLegacy, connectLegacy } from './layout.js';

export const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'skyline',
  password: process.env.DB_PASSWORD || 'skyline',
  database: process.env.DB_NAME || 'skyline',
  connectionLimit: 10,
  bigIntAsNumber: true,
  insertIdAsNumber: true,
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS airports (
    id INT PRIMARY KEY, ident VARCHAR(16), iata VARCHAR(4), type VARCHAR(20), name VARCHAR(160),
    lat DOUBLE, lon DOUBLE, country CHAR(2), city VARCHAR(120), runway_m INT, wiki VARCHAR(255),
    INDEX (lat, lon), INDEX (iata), INDEX (ident), INDEX (name))`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(24) UNIQUE NOT NULL, company VARCHAR(40) NOT NULL,
    pass_hash VARCHAR(200) NOT NULL, cash DOUBLE NOT NULL, last_tick BIGINT NOT NULL, color CHAR(7) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token CHAR(64) PRIMARY KEY, user_id INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS owned_airports (
    airport_id INT PRIMARY KEY, user_id INT NOT NULL, layout TEXT NOT NULL, bought_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (airport_id) REFERENCES airports(id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX (user_id))`,
  `CREATE TABLE IF NOT EXISTS aircraft (
    id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, model VARCHAR(8) NOT NULL, base_id INT NOT NULL,
    dest_id INT NULL, fare_mult DOUBLE NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX (user_id), INDEX (base_id, dest_id))`,
  `CREATE TABLE IF NOT EXISTS history (
    user_id INT NOT NULL, ts BIGINT NOT NULL, cash DOUBLE NOT NULL, profit DOUBLE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, INDEX (user_id, ts))`,
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS xp DOUBLE NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS license INT NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS debt DOUBLE NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_hist BIGINT NOT NULL DEFAULT 0',
  `CREATE TABLE IF NOT EXISTS avatars (
    user_id INT PRIMARY KEY, mime VARCHAR(16) NOT NULL, data MEDIUMBLOB NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(200) NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN IF NOT EXISTS lang VARCHAR(5) NOT NULL DEFAULT 'da'",
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_ver INT NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS bankruptcies INT NOT NULL DEFAULT 0',
  'ALTER TABLE owned_airports MODIFY layout MEDIUMTEXT NOT NULL',
  'ALTER TABLE owned_airports ADD COLUMN IF NOT EXISTS layout_v INT NOT NULL DEFAULT 1',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS bankrupt_notice TEXT NULL',
  'ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS cond DOUBLE NOT NULL DEFAULT 100',
  'ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS bought_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP',
];

export async function init() {
  for (let i = 0; ; i++) {
    try { await pool.query('SELECT 1'); break; }
    catch (e) { if (i > 30) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
  for (const sql of SCHEMA) await pool.query(sql);
  const [{ n }] = await pool.query('SELECT COUNT(*) n FROM airports');
  if (!n) await importAirports();
  // One-time move of pre-3D layouts onto the 10 m site plan.
  for (const r of await pool.query(
    'SELECT o.airport_id, o.user_id, o.layout, a.type, a.runway_m FROM owned_airports o JOIN airports a ON a.id = o.airport_id WHERE o.layout_v < 2')) {
    const { layout, refund } = migrateLegacy(r.type, r.runway_m, JSON.parse(r.layout));
    await pool.query('UPDATE owned_airports SET layout = ?, layout_v = 2 WHERE airport_id = ?', [JSON.stringify(layout), r.airport_id]);
    if (refund) await pool.query('UPDATE users SET cash = cash + ? WHERE id = ?', [refund, r.user_id]);
    console.log(`Layout for lufthavn ${r.airport_id} flyttet til 3D (${layout.length} elementer, refunderet $${refund})`);
  }
  // v2 → v3: items now need real road/taxiway access; connect existing ones once.
  for (const r of await pool.query(
    'SELECT o.airport_id, o.layout, a.type, a.runway_m FROM owned_airports o JOIN airports a ON a.id = o.airport_id WHERE o.layout_v < 3')) {
    const layout = connectLegacy(r.type, r.runway_m, JSON.parse(r.layout));
    await pool.query('UPDATE owned_airports SET layout = ?, layout_v = 3 WHERE airport_id = ?', [JSON.stringify(layout), r.airport_id]);
    console.log(`Lufthavn ${r.airport_id}: veje og taxiveje forbundet (${layout.length} elementer)`);
  }
}

// Open data from OurAirports (public domain): https://ourairports.com/data/
const SRC = 'https://davidmegginson.github.io/ourairports-data/';

async function fetchCsv(file) {
  const res = await fetch(SRC + file);
  if (!res.ok) throw new Error(`OurAirports ${file}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function importAirports() {
  console.log('Henter lufthavne fra OurAirports …');
  const [airports, runways] = await Promise.all([fetchCsv('airports.csv'), fetchCsv('runways.csv')]);
  const longest = {};
  for (const r of runways) {
    if (r.closed === '1') continue;
    longest[r.airport_ref] = Math.max(longest[r.airport_ref] || 0, Math.round(r.length_ft * 0.3048) || 0);
  }
  const rows = airports
    .filter(a => a.type === 'large_airport' || a.type === 'medium_airport' || (a.type === 'small_airport' && a.iata_code))
    .map(a => [
      +a.id, a.ident, a.iata_code || null, a.type, a.name.slice(0, 160), +a.latitude_deg, +a.longitude_deg,
      a.iso_country.slice(0, 2), a.municipality.slice(0, 120), longest[a.id] || DEFAULT_RUNWAY_M[a.type],
      a.wikipedia_link.slice(0, 255) || null,
    ]);
  await pool.batch('INSERT IGNORE INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?)', rows);
  console.log(`Importerede ${rows.length} lufthavne`);
}
