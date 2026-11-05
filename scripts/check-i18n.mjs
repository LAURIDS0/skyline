// Checks that every translatable string has a translation in every language file.
// Run: node scripts/check-i18n.mjs   (prints missing keys, exits 1 if any; --dump prints all keys as JSON)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const keys = new Set();
const grab = (text, re) => { for (const m of text.matchAll(re)) keys.add(m[1].replace(/\\'/g, "'")); };

for (const f of ['app.js', 'builder3d.js', 'models3d.js', 'api.js']) {
  const src = read(`frontend/js/${f}`);
  grab(src, /\bt\(\s*'((?:[^'\\]|\\.)+)'/g);
  grab(src, /\[\d+, '[^']+', '([^']+)'\]/g); // weather codes in api.js
  grab(src, /(?:large|medium|small)_airport: '([^']+)'/g);
}
grab(read('frontend/index.html'), /data-i18n(?:-ph|-title)?="([^"]+)"/g);
// Server error messages: the string right after fail(status, …), key:, or a ternary inside those.
for (const line of read('backend/src/server.js').split('\n')) {
  if (/fail\(|key: /.test(line)) grab(line, /(?:fail\(\d+,\s*|key:\s*|\?\s*|:\s*)'(?!SELECT|UPDATE|INSERT|DELETE)([A-ZÆØÅ][^']*)'/g);
}
const eco = read('backend/src/economy.js');
grab(eco, /note: '([^']+)'/g);
grab(eco, /return '([^']+)'/g);
grab(read('backend/src/layout.js'), /'([A-ZÆØÅ][^']*\s[^']*)'/g);
grab(read('backend/src/analysis.js'), /'([A-ZÆØÅ][^']*\s[^']*)'/g);
grab(read('frontend/js/builder3d.js'), /\['\w+', '([A-ZÆØÅ][^']*)'\]/g); // CHAIN and demolish-layer labels
grab(eco, /\? '([^']+)' : null/g);

const C = await import(pathToFileURL(path.join(root, 'backend/src/catalog.js')));
for (const b of Object.values(C.BUILDINGS)) [b.name, b.desc, b.group].forEach(k => keys.add(k));
for (const l of C.LICENSES) [l.name, l.desc].forEach(k => keys.add(k));
Object.values(C.CATEGORIES).forEach(k => keys.add(k));

if (process.argv.includes('--dump')) { console.log(JSON.stringify([...keys].sort(), null, 1)); process.exit(0); }

let missing = 0;
for (const file of fs.readdirSync(path.join(root, 'frontend/js/lang'))) {
  const dict = (await import(pathToFileURL(path.join(root, 'frontend/js/lang', file)))).default;
  const lack = [...keys].filter(k => !(k in dict));
  const extra = Object.keys(dict).filter(k => !keys.has(k));
  const badParams = Object.entries(dict).filter(([k, v]) => keys.has(k) &&
    [...k.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join() !== [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join());
  missing += lack.length + badParams.length;
  console.log(`${file}: ${keys.size - lack.length}/${keys.size} keys` + (extra.length ? `, ${extra.length} unused` : ''));
  lack.forEach(k => console.log('  missing:', k));
  badParams.forEach(([k]) => console.log('  params differ:', k));
}
process.exit(missing ? 1 : 0);
