import { api, upload, avatarUrl, hasToken, setToken, weather } from './api.js';
import { t, setLang, getLang, initialLang, locale, LANGS, translateDom } from './i18n.js';
import { initMap, loadAirports, drawWorld, drawMyRoutes, animatePlanes, showRange, focus } from './map.js';
import { openBuilder } from './builder3d.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
let fmt, fmt1, fmtC;
function applyLocale() {
  const nf = o => new Intl.NumberFormat(locale(), o);
  fmt = nf({ maximumFractionDigits: 0 });
  fmt1 = nf({ maximumFractionDigits: 1 });
  fmtC = nf({ notation: 'compact', maximumFractionDigits: 2 });
}
const money = n => (n < 0 ? '−$' : '$') + (Math.abs(n) >= 1e6 ? fmtC : fmt).format(Math.abs(n));
const flag = cc => cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '';
const code = a => a.iata || a.ident;
const typeName = type => t({ large_airport: 'Stor lufthavn', medium_airport: 'Mellemstor lufthavn', small_airport: 'Lille lufthavn' }[type]);
const avatar = (u, cls = '') => u.avatar_ver
  ? `<img class="avatar ${cls}" src="${avatarUrl(u)}" alt="">`
  : `<span class="avatar ${cls}" style="background:${u.color}">${esc((u.company || '?')[0].toUpperCase())}</span>`;
const COLORS = ['#f5b942', '#4fd1c5', '#f472b6', '#a78bfa', '#60a5fa', '#34d399', '#fb923c', '#f87171', '#facc15', '#38bdf8'];

const S = { cat: null, state: null, fetchedAt: 0, tab: 'overview', fleetFilter: 'all', picking: null, detailId: null, started: false };

function toast(msg, kind = 'good') {
  const el = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: msg });
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}
async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); await refresh(); } catch (e) { toast(e.message, 'bad'); }
}
const gameHours = () => (Date.now() - S.cat.GAME_EPOCH) / 1000 * S.cat.GAME_HOURS_PER_SEC;
const liveCash = () => S.state.user.cash + S.state.totals.profit * S.cat.MONEY_HOURS_PER_SEC * (performance.now() - S.fetchedAt) / 1000;
// Economy computes per game hour; money is credited faster than the clock, so show rates per real minute.
const perMin = n => n * S.cat.MONEY_HOURS_PER_SEC * 60;
const km = (a, b) => {
  const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const bname = k => t(S.cat.BUILDINGS[k].name);
const hasBuilding = (stats, k) => (k === 'cargo' ? stats.cargoT > 0 : !!stats.count[k]);
const license = () => S.cat.LICENSES[S.state.user.license];
const condClass = c => (c < S.cat.GROUNDED_BELOW ? 'bad' : c < 50 ? 'warnc' : 'good');

// ---------- language ----------
const langOptions = () => Object.entries(LANGS).map(([k, l]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${l.name}</option>`).join('');
async function changeLang(code, save) {
  await setLang(code);
  applyLocale();
  $('#auth-lang').innerHTML = langOptions();
  $('#auth-submit').textContent = mode === 'login' ? t('Log ind') : t('Opret selskab');
  if (save) await api('/me', { lang: code }).catch(() => {});
  if (!S.state) return;
  await refresh();
  if (S.detailId) openDetail(S.detailId);
  if (location.hash === '#/me') renderMyPage();
}
$('#auth-lang').onchange = e => changeLang(e.target.value);

// ---------- auth ----------
let mode = 'login';
$('#auth-form .seg').onclick = e => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  mode = b.dataset.mode;
  document.querySelectorAll('#auth-form .seg button').forEach(x => x.classList.toggle('active', x === b));
  $('.register-only').hidden = mode === 'login';
  $('#auth-submit').textContent = mode === 'login' ? t('Log ind') : t('Opret selskab');
};
$('#auth-form').onsubmit = async e => {
  e.preventDefault();
  try {
    setToken((await api('/' + mode, Object.fromEntries(new FormData(e.target)))).token);
    if (mode === 'register') await api('/me', { lang: getLang() });
    enter();
  } catch (err) { $('#auth-error').textContent = err.message; }
};
$('#logout').onclick = async () => { await api('/logout', {}).catch(() => {}); setToken(null); location.hash = ''; location.reload(); };

// ---------- main loop ----------
async function refresh() {
  S.state = await api('/state');
  S.fetchedAt = performance.now();
  const u = S.state.user;
  $('#company').textContent = u.company;
  $('#my-avatar').innerHTML = avatar(u, 'sm');
  $('#license').textContent = t(license().name);
  const r = perMin(S.state.totals.profit);
  $('#rate').textContent = (r >= 0 ? '+' : '') + money(r);
  $('#rate').className = 'mono ' + (r >= 0 ? 'good' : 'bad');
  $('#fuel').textContent = `$${S.state.fuel.toFixed(2)}/kg`;
  drawMyRoutes(S.state.fleet);
  if (S.tab !== 'leaderboard') renderPanel();
  if (u.bankrupt_notice) showBankruptcy(u.bankrupt_notice);
}

function showBankruptcy(n) {
  const el = $('#modal');
  el.onmousemove = null;
  el.onclick = null;
  el.innerHTML = `<div class="bankrupt card" role="alertdialog" aria-labelledby="bk-title">
    <div class="bk-icon"><i class="fa-solid fa-gavel"></i></div>
    <h2 id="bk-title">${t('Konkurs!')}</h2>
    <p><b>${t('{company} er gået konkurs', { company: S.state.user.company })}</b></p>
    <p class="muted">${t('Overtrækket nåede {debt} – grænsen var {limit}. Banken har overtaget dine {a} lufthavne og {p} fly.', { debt: money(n.overdraft), limit: money(n.limit), a: n.airports, p: n.planes })}</p>
    <p class="muted">${t('Du starter forfra med {cash} og licensen Regional.', { cash: money(S.cat.START_CASH) })}</p>
    <button class="primary wide" data-ack-bankruptcy>${t('Start forfra')}</button>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-ack-bankruptcy]').onclick = async () => {
    await api('/me/ack-bankruptcy', {}).catch(() => {});
    el.hidden = true;
    loadAirports();
    refresh();
  };
}

async function enter() {
  const me = await api('/state');
  if (me.user.lang !== getLang()) await changeLang(me.user.lang);
  $('#auth').hidden = true;
  $('#topbar').hidden = $('#sidebar').hidden = false;
  await refresh();
  initMap({ myId: S.state.user.id, onSelect: openDetail, tileKey: S.cat.MAP_KEY });
  const world = async () => drawWorld((await api('/world')).routes);
  world();
  setInterval(() => refresh().catch(() => {}), 10_000);
  setInterval(() => world().catch(() => {}), 30_000);
  setInterval(() => {
    const cash = liveCash();
    $('#cash').textContent = money(cash);
    $('#cash').classList.toggle('neg', cash < 0);
    const h = gameHours(), pad = n => String(Math.floor(n)).padStart(2, '0');
    $('#clock').textContent = `${t('Dag')} ${fmt.format(Math.floor(h / 24) + 1)} · ${pad(h % 24)}:${pad(h * 60 % 60)}`;
    animatePlanes(h, S.cat.TURNAROUND_H);
  }, 200);
  S.started = true;
  route();
}

// ---------- sidebar panels ----------
$('#tabs').onclick = e => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  S.tab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  renderPanel();
};

function bar(label, used, cap, unit = '') {
  const pct = cap ? Math.min(100, used / cap * 100) : used ? 100 : 0;
  return `<div class="bar-row"><span>${label}</span><span class="mono">${fmt1.format(used)} / ${fmt1.format(cap)}${unit}</span>
    <div class="bar ${used > cap ? 'over' : ''}"><i style="width:${pct}%"></i></div></div>`;
}

function sparkline(hist) {
  if (hist.length < 2) return `<p class="muted small">${t('Grafen over din kasse fyldes ud, mens du spiller (ét punkt pr. minut).')}</p>`;
  const W = 320, H = 80, ys = hist.map(p => p.cash), t0 = hist[0].ts, t1 = hist.at(-1).ts;
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const pts = hist.map(p => [(p.ts - t0) / (t1 - t0 || 1) * W, H - 4 - (p.cash - lo) / span * (H - 8)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return `<div class="spark-wrap" data-hist='${esc(JSON.stringify(hist.map(p => [p.ts, Math.round(p.cash)])))}'>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('Kassebeholdning · seneste døgn')}">
      <path class="area" d="${line}L${W},${H}L0,${H}Z"/><path class="line" d="${line}"/>
      <line class="cross" x1="0" x2="0" y1="0" y2="${H}" hidden/></svg>
    <div class="spark-tip" hidden></div>
    <div class="spark-axis small muted"><span>${money(lo)}</span><span>${money(hi)}</span></div></div>`;
}
$('#panel').addEventListener('mousemove', e => {
  const wrap = e.target.closest('.spark-wrap');
  if (!wrap) return;
  const hist = JSON.parse(wrap.dataset.hist), r = wrap.querySelector('svg').getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const at = hist[0][0] + f * (hist.at(-1)[0] - hist[0][0]);
  const p = hist.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a));
  const x = (p[0] - hist[0][0]) / (hist.at(-1)[0] - hist[0][0] || 1) * 320;
  const cross = wrap.querySelector('.cross'), tip = wrap.querySelector('.spark-tip');
  cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.hidden = false;
  tip.hidden = false;
  tip.style.left = `${x / 320 * 100}%`;
  tip.innerHTML = `<b class="mono">${money(p[1])}</b><span class="muted">${new Date(p[0]).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span>`;
});
$('#panel').addEventListener('mouseleave', () => document.querySelectorAll('.spark-tip, .cross').forEach(el => (el.hidden = true)), true);

const PANELS = {
  overview() {
    const tot = Object.fromEntries(Object.entries(S.state.totals).map(([k, v]) => [k, perMin(v)])), { owned, fleet } = S.state;
    const steps = [
      [owned.length > 0, t('Find en lufthavn på kortet og køb den')],
      [owned.some(o => o.stats.pax > 0), t('Byg en terminal')],
      [owned.some(o => o.stats.gates.S + o.stats.gates.M + o.stats.gates.L > 0), t('Byg en gate')],
      [fleet.length > 0, t('Køb dit første fly')],
      [fleet.some(a => a.dest_id), t('Giv flyet en rute – “Ny rute” under Flåde')],
    ];
    const income = [[t('Billetter'), tot.revenue], [t('Fragt'), tot.cargo], [t('Butik, mad, parkering, hotel'), tot.ancillary]];
    const costs = [[t('Brændstof'), tot.fuel], [t('Vedligehold'), tot.maintenance], [t('Besætning'), tot.crew], [t('Forsikring'), tot.insurance],
      [t('Landingsafgifter'), tot.fees], [t('Administration'), tot.overhead], [t('Drift af bygninger'), tot.upkeep], [t('Renter'), tot.interest], [t('Overtræksrenter'), tot.overdraft]];
    const inc = income.reduce((s, r) => s + r[1], 0);
    const u = S.state.user, cash = liveCash();
    return `
      ${cash < 0 ? `<section class="overdraft"><h3><i class="fa-solid fa-triangle-exclamation"></i> ${t('Overtræk')}</h3>
        ${bar(t('Gæld før konkurs'), Math.round(-cash), Math.round(-u.bankruptAt))}
        <p class="small">${t('Din kasse er i minus. Ved {limit} i overtræk går selskabet konkurs ($250.000 pr. lufthavn). Sælg fly, skær ned eller lån i banken.', { limit: money(-u.bankruptAt) })}</p>
      </section>` : ''}
      ${steps.every(s => s[0]) ? '' : `<section><h3>${t('Kom i gang')}</h3><ol class="steps">${steps.map(([done, txt]) => `<li class="${done ? 'done' : ''}">${txt}</li>`).join('')}</ol></section>`}
      <section><h3>${t('Kassebeholdning · seneste døgn')}</h3>${sparkline(S.state.history)}</section>
      <section><h3>${t('Resultat pr. minut')}</h3>
        <div class="kpis">
          <div><span>${t('Indtægt')}</span><b class="mono good">${money(inc)}</b></div>
          <div><span>${t('Omkostning')}</span><b class="mono bad">${money(inc - tot.profit)}</b></div>
          <div><span>${t('Resultat')}</span><b class="mono ${tot.profit >= 0 ? 'good' : 'bad'}">${money(tot.profit)}</b></div>
        </div>
        <dl class="ledger">${income.map(([k, v]) => `<dt>${k}</dt><dd class="mono">${money(v)}</dd>`).join('')}
          ${costs.filter(([, v]) => v > 0.5).map(([k, v]) => `<dt>${k}</dt><dd class="mono bad">${money(-v)}</dd>`).join('')}</dl>
        <p class="muted small">${t('Passagerer og fragt: {pax} pax · {t} t pr. minut', { pax: Math.round(tot.pax), t: Math.round(tot.cargoT * 10) / 10 })}</p>
      </section>
      ${owned.map(o => {
        const s = o.stats, wx = s.weather;
        return `<section class="hub"><h3>${flag(o.country)} ${esc(code(o))} <small>${esc(o.name)}</small></h3>
          ${wx ? `<p class="small muted">${t('Vejr: {temp}°C · vind {wind} km/t', { temp: Math.round(wx.temp), wind: Math.round(wx.wind) })}</p>` : ''}
          ${bar(t('Passagerer/t'), Math.round(s.paxUsed), Math.round(s.pax))}
          ${s.cargoUsed || s.cargoT ? bar(t('Fragt/t'), Math.round(s.cargoUsed * 10) / 10, s.cargoT, ' t') : ''}
          ${bar(t('Bevægelser/t'), Math.round(s.movUsed * 10) / 10, Math.round(s.movCap * 10) / 10)}
          ${s.weatherNote ? `<p class="warn"><i class="fa-solid fa-cloud-bolt"></i> ${t(s.weatherNote)}</p>` : ''}
          ${s.movFactor < 1 ? `<p class="warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t('For lidt banekapacitet – {p}% af flyvningerne aflyses.', { p: Math.round((1 - s.movFactor) * 100) })}</p>` : ''}
          ${s.paxFactor < 1 ? `<p class="warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t('Terminalen er fuld – kun {p}% af passagererne kommer med.', { p: Math.round(s.paxFactor * 100) })}</p>` : ''}
          ${s.cargoFactor < 1 ? `<p class="warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t('Fragtterminalen er fuld – kun {p}% af fragten kommer med.', { p: Math.round(s.cargoFactor * 100) })}</p>` : ''}
        </section>`;
      }).join('')}`;
  },

  airports() {
    const { owned } = S.state;
    if (!owned.length) return `<p class="empty">${t('Du ejer ingen lufthavne endnu. Klik på en lufthavn på kortet for at købe den.')}</p>`;
    return owned.map(o => `<div class="item">
      <div class="item-head"><b>${flag(o.country)} ${esc(code(o))}</b><span class="muted">${esc(o.name)}</span></div>
      <div class="item-meta"><span>${typeName(o.type)}</span><span>${t('Bane {m} m', { m: o.runway_eff })}</span><span>${t('{n} bygninger', { n: o.layout.length })}</span>
        <span>${t('Gates')} ${o.stats.gates.S}/${o.stats.gates.M}/${o.stats.gates.L}</span><span>${t('Stande')} ${o.stats.stands.S}/${o.stats.stands.M}/${o.stats.stands.L}</span></div>
      <div class="actions">
        <button class="primary" data-build="${o.id}"><i class="fa-solid fa-trowel-bricks"></i> ${t('Byg')}</button>
        <button data-buyplane="${o.id}"><i class="fa-solid fa-cart-plus"></i> ${t('Køb fly')}</button>
        <button data-show="${o.id}" aria-label="${t('Vis på kortet')}"><i class="fa-solid fa-location-crosshairs"></i></button>
      </div></div>`).join('');
  },

  fleet() {
    const { fleet, owned } = S.state;
    const list = fleet.filter(a => S.fleetFilter === 'all' || (S.fleetFilter === 'cargo') === (S.cat.AIRCRAFT[a.model].cat === 'cargo'));
    return `${owned.length ? `<button class="primary wide" data-buyplane="${owned[0].id}"><i class="fa-solid fa-cart-plus"></i> ${t('Køb fly')}</button>` : ''}
      <div class="seg three">${[['all', t('Alle')], ['pax', t('Passager')], ['cargo', t('Fragt')]].map(([k, l]) =>
        `<button data-fleet-filter="${k}" class="${S.fleetFilter === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? '' : `<p class="empty">${t('Ingen fly her endnu.')}</p>`}
      ${list.map(a => {
        const m = S.cat.AIRCRAFT[a.model], e = a.econ || {}, cargo = m.cat === 'cargo';
        const overhaul = m.price * S.cat.OVERHAUL_COST, resale = m.price * S.cat.SELL_FACTOR * (0.5 + a.cond / 200);
        return `<div class="item">
          <div class="item-head"><b>${cargo ? `<i class="fa-solid fa-box" title="${t('Fragtfly')}"></i> ` : ''}${esc(m.name)}</b><span class="muted mono">#${a.id}</span></div>
          <div class="route mono">${esc(a.base_iata || a.base_ident)} <i class="fa-solid fa-arrow-right-arrow-left"></i> ${a.dest_id ? esc(a.dest_iata || a.dest_ident) : `<span class="muted">${t('parkeret')}</span>`}</div>
          <div class="bar-row"><span>${t('Stand')}</span><span class="mono ${condClass(a.cond)}">${Math.round(a.cond)}%</span>
            <div class="bar cond ${condClass(a.cond)}"><i style="width:${a.cond}%"></i></div></div>
          ${e.grounded ? `<p class="warn"><i class="fa-solid fa-ban"></i> ${t('Grounded af luftfartsmyndigheden – kræver eftersyn.')}</p>` : ''}
          ${a.dest_id && !e.idle ? `<div class="item-meta"><span>${fmt.format(e.km)} km</span>
            ${m.seats ? `<span>${t('Pax')} ${Math.round(e.lf * 100)}%</span><span>${t('Billet')} ${money(e.fare)}</span>` : ''}
            ${e.cargoLf ? `<span>${t('Fragt')} ${Math.round(e.cargoLf * 100)}%</span>` : ''}
            <span class="${e.profit >= 0 ? 'good' : 'bad'}">${money(perMin(e.profit))}/min</span></div>
            <label class="fare">${t('Prisniveau')} <output>${Math.round(a.fare_mult * 100)}%</output>
              <input type="range" min="50" max="200" step="5" value="${Math.round(a.fare_mult * 100)}" data-fare="${a.id}"></label>
            <small class="fare-preview" id="fp-${a.id}">${t('Billigere billetter fylder flere sæder – dyrere giver flere tomme sæder.')}</small>`
            : `<div class="item-meta"><span class="bad">${money(perMin(e.profit || 0))}/min (${t('står stille – løn, forsikring og vedligehold løber')})</span></div>`}
          <div class="actions">
            <button class="primary" data-pick="${a.id}"><i class="fa-solid fa-route"></i> ${t('Ny rute')}</button>
            ${a.dest_id ? `<button data-park="${a.id}"><i class="fa-solid fa-square-parking"></i> ${t('Parkér')}</button>` : ''}
            ${a.cond < 99 ? `<button data-overhaul="${a.id}" title="${t('Eftersyn (C-check) i hangar')}"><i class="fa-solid fa-screwdriver-wrench"></i> ${money(overhaul)}</button>` : ''}
            <button class="danger" data-sell="${a.id}" data-price="${Math.round(resale)}" title="${t('Sælg')}"><i class="fa-solid fa-hand-holding-dollar"></i> ${money(resale)}</button>
          </div></div>`;
      }).join('')}`;
  },

  company() {
    const u = S.state.user, L = S.cat.LICENSES;
    const next = L[u.license + 1];
    return `
      <section><h3>${t('Selskab')}</h3>
        <dl class="ledger"><dt>${t('Selskabsværdi')}</dt><dd class="mono">${money(u.value)}</dd>
          <dt>${t('Erfaringspoint')}</dt><dd class="mono">${fmt.format(u.xp)}</dd>
          <dt>${t('Flåde')}</dt><dd class="mono">${t('{n} fly', { n: S.state.fleet.length })}</dd></dl>
        <p class="muted small">${t('Erfaring optjenes pr. passager og pr. 0,1 ton fragt, du flyver.')}</p></section>
      <section><h3>${t('Licens (AOC)')}</h3>
        <ol class="ladder">${L.map((l, i) => `<li class="${i < u.license ? 'done' : i === u.license ? 'current' : ''}">
          <b>${t(l.name)}</b><span class="muted small">${t(l.desc)} · ${t('ruter op til {km} km', { km: l.maxKm })}</span></li>`).join('')}</ol>
        ${next ? `${bar(t('Erfaring til {name}', { name: next.name }), Math.round(u.xp), next.xp)}
          <button class="primary wide" data-license ${u.xp < next.xp || liveCash() < next.cost ? 'disabled' : ''}>
            <i class="fa-solid fa-certificate"></i> ${t('Køb {name}', { name: next.name })} · ${money(next.cost)}</button>` : `<p class="good">${t('Du har den højeste licens.')}</p>`}
      </section>
      <section><h3>${t('Bank')}</h3>
        <dl class="ledger"><dt>${t('Lån')}</dt><dd class="mono ${u.debt ? 'bad' : ''}">${money(u.debt)}</dd>
          <dt>${t('Kreditramme')}</dt><dd class="mono">${money(u.credit)}</dd>
          <dt>${t('Renter')}</dt><dd class="mono">${money(perMin(S.state.totals.interest))}/min</dd></dl>
        <div class="actions">${[1e6, 10e6, 100e6].filter(s => u.debt + s <= u.credit).map(s => `<button data-loan="${s}"><i class="fa-solid fa-building-columns"></i> ${t('Lån')} ${money(s)}</button>`).join('')}
          ${u.debt ? `<button data-loan="${-u.debt}" class="primary">${t('Indfri alt')}</button>` : ''}</div>
        <p class="muted small">${t('Kreditrammen er $2 mio. plus halvdelen af værdien af dine fly og lufthavne.')}</p>
        <p class="muted small">${t('Går kassen i minus, betaler du overtræksrente. Ved {limit} i overtræk går selskabet konkurs ($250.000 pr. lufthavn).', { limit: money(-u.bankruptAt) })}</p>
      </section>`;
  },

  async leaderboard() {
    const list = await api('/leaderboard');
    return `<ol class="board">${list.map(u => `<li class="${u.id === S.state.user.id ? 'me' : ''}" data-profile="${u.id}" tabindex="0" role="button">
      ${avatar(u, 'xs')}<b>${esc(u.company)}</b>
      <span class="muted">${t(S.cat.LICENSES[u.license].name)} · ${t('{a} lufthavne · {p} fly', { a: u.airports, p: u.planes })}</span><span class="mono">${money(u.value)}</span></li>`).join('')}</ol>`;
  },
};

async function renderPanel() {
  const html = await PANELS[S.tab]();
  // Don't clobber a fare slider the user is dragging.
  if (!document.activeElement?.matches('#panel input')) $('#panel').innerHTML = html;
}

let farePreview;
$('#panel').addEventListener('input', e => {
  const id = e.target.dataset.fare;
  if (!id) return;
  e.target.previousElementSibling.textContent = e.target.value + '%';
  clearTimeout(farePreview);
  farePreview = setTimeout(async () => {
    const a = S.state.fleet.find(x => x.id === +id), out = $(`#fp-${id}`);
    const r = await api(`/aircraft/${id}/preview?dest=${a.dest_id}&fare=${e.target.value / 100}`).catch(() => null);
    if (!r?.route || !out) return;
    out.innerHTML = t('Ved {p}%: belægning {lf}%, billet {fare}, resultat {profit}/min', {
      p: +e.target.value, lf: Math.round(r.route.lf * 100), fare: money(r.route.fare), profit: money(perMin(r.route.profit)) });
  }, 150);
});
$('#panel').addEventListener('change', e => {
  const id = e.target.dataset.fare;
  if (!id) return;
  const a = S.state.fleet.find(x => x.id === +id);
  e.target.blur();
  act(() => api(`/aircraft/${id}/route`, { dest_id: a.dest_id, fare_mult: e.target.value / 100 }));
});

const ACTIONS = '[data-build],[data-buyplane],[data-show],[data-pick],[data-park],[data-sell],[data-overhaul],[data-buy-airport],[data-route-to],[data-close-detail],[data-cancel-pick],[data-profile],[data-goto],[data-fleet-filter],[data-license],[data-loan]';
document.addEventListener('click', e => {
  const el = e.target.closest(ACTIONS);
  if (!el) return;
  const d = el.dataset;
  if (d.profile) { e.preventDefault(); openProfile(+d.profile); }
  else if (d.goto) { $('#modal').hidden = true; location.hash = ''; focus(+d.lat, +d.lon); openDetail(+d.goto); }
  else if (d.build) openBuild(+d.build);
  else if (d.buyplane) openPlaneShop(+d.buyplane);
  else if (d.show) { const o = S.state.owned.find(x => x.id === +d.show); focus(o.lat, o.lon); openDetail(o.id); }
  else if (d.pick) startPick(+d.pick);
  else if (d.park) act(() => api(`/aircraft/${d.park}/route`, { dest_id: null }), t('Flyet er parkeret'));
  else if (d.overhaul) act(() => api(`/aircraft/${d.overhaul}/overhaul`, {}), t('Eftersyn gennemført – flyet er som nyt'));
  else if (d.sell && confirm(t('Sælg flyet for {price}?', { price: money(+d.price) }))) act(() => api(`/aircraft/${d.sell}/sell`, {}), t('Fly solgt'));
  else if (d.fleetFilter) { S.fleetFilter = d.fleetFilter; renderPanel(); }
  else if (d.license !== undefined) act(() => api('/license', {}), t('Ny licens! Flere fly og længere ruter er låst op.'));
  else if (d.loan) act(() => api('/loan', { amount: +d.loan }), +d.loan > 0 ? t('Lånet er udbetalt') : t('Lånet er indfriet'));
  else if (d.buyAirport) act(async () => { await api(`/airports/${d.buyAirport}/buy`, {}); loadAirports(); openDetail(+d.buyAirport); }, t('Lufthavn købt! Byg nu terminal og gates.'));
  else if (d.routeTo) act(async () => { await api(`/aircraft/${S.picking.id}/route`, { dest_id: +d.routeTo }); stopPick(); openDetail(+d.routeTo); }, t('Ruten er oprettet'));
  else if (d.closeDetail !== undefined) { $('#detail').hidden = true; S.detailId = null; }
  else if (d.cancelPick !== undefined) stopPick();
});

// ---------- airport detail ----------
async function openDetail(id) {
  S.detailId = id;
  const el = $('#detail');
  el.hidden = false;
  el.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i></div>';
  const a = await api('/airports/' + id);
  if (S.detailId !== id) return;
  const mine = a.owner_id === S.state.user.id;
  const p = S.picking;
  el.innerHTML = `
    <header><div><div class="code mono">${flag(a.country)} ${esc(code(a))}</div><h2>${esc(a.name)}</h2>
      <p class="muted">${esc(a.city)}${a.city ? ', ' : ''}${esc(a.country)} · ${a.ident}</p></div>
      <button class="icon" data-close-detail aria-label="${t('Luk')}"><i class="fa-solid fa-xmark"></i></button></header>
    ${p ? `<section class="pick-box" id="pick-box"><h3>${t('Ny rute')}: ${esc(p.base_iata || p.base_ident)} → ${esc(code(a))}</h3>
      <div class="muted small"><i class="fa-solid fa-spinner fa-spin"></i> ${t('Beregner …')}</div></section>` : ''}
    <div class="chips"><span class="chip">${typeName(a.type)}</span>
      <span class="chip"><i class="fa-solid fa-ruler-horizontal"></i> ${t('Bane {m} m', { m: a.runway_eff })}</span>
      <span class="chip"><i class="fa-solid fa-plane"></i> ${t('{n} fly', { n: a.flights })}</span></div>
    <div class="weather" id="wx"><i class="fa-solid fa-spinner fa-spin"></i> ${t('Henter vejr …')}</div>
    <section>${a.owner_id
      ? `<p class="owner"><span class="dot" style="background:${a.owner_color}"></span> ${t('Ejes af')} <a href="#" data-profile="${a.owner_id}"><b>${esc(a.owner_company)}</b></a>${mine ? ` (${t('dig')})` : ''}</p>`
      : `<p class="owner muted">${t('Ingen ejer · koncession')} <b class="mono">${money(a.price)}</b></p>
         <button class="primary wide" data-buy-airport="${a.id}" ${liveCash() < a.price ? 'disabled' : ''}><i class="fa-solid fa-key"></i> ${t('Køb lufthavn')}</button>`}
      ${mine ? `<div class="actions"><button class="primary" data-build="${a.id}"><i class="fa-solid fa-trowel-bricks"></i> ${t('Byg')}</button>
        <button data-buyplane="${a.id}"><i class="fa-solid fa-cart-plus"></i> ${t('Køb fly her')}</button></div>` : ''}
      ${a.owner_id && !mine ? `<p class="muted small">${t('Du betaler landingsafgift til ejeren, når du flyver hertil.')}</p>` : ''}
    </section>
    ${a.wiki ? `<a class="small" href="${esc(a.wiki)}" target="_blank" rel="noopener"><i class="fa-brands fa-wikipedia-w"></i> ${t('Læs om lufthavnen')}</a>` : ''}`;
  if (p) previewRoute(p, a);
  weather(a.lat, a.lon).then(w => {
    if (S.detailId === id) $('#wx').innerHTML = `<span class="wx-icon">${w.icon}</span><b>${w.temp}°C</b> ${w.text}
      <span class="muted"><i class="fa-solid fa-wind"></i> ${w.wind} km/t <i class="fa-solid fa-location-arrow" style="transform:rotate(${w.dir + 135}deg)"></i></span>`;
  }).catch(() => { if (S.detailId === id) $('#wx').textContent = t('Vejr utilgængeligt'); });
}

async function previewRoute(p, a) {
  const m = S.cat.AIRCRAFT[p.model], dist = km({ lat: p.blat, lon: p.blon }, a);
  const r = await api(`/aircraft/${p.id}/preview?dest=${a.id}`).catch(e => ({ message: e.message }));
  const box = $('#pick-box');
  if (!box || S.detailId !== a.id) return;
  const e = r.route, err = r.message || (r.error && t(r.error, r.params));
  box.innerHTML = `<h3>${t('Ny rute')}: ${esc(p.base_iata || p.base_ident)} → ${esc(code(a))}</h3>
    <div class="item-meta"><span>${fmt.format(dist)} km</span><span>${t('{h} t flyvetid', { h: fmt1.format(dist / m.speedKmh) })}</span></div>
    ${err ? `<p class="warn">${esc(err)}</p>` : `
      <dl class="ledger">
        ${m.seats ? `<dt>${t('Forventet belægning')}</dt><dd class="mono">${Math.round(e.lf * 100)}%</dd><dt>${t('Billetpris')}</dt><dd class="mono">${money(e.fare)}</dd>` : ''}
        ${e.cargoLf ? `<dt>${t('Fragtudnyttelse')}</dt><dd class="mono">${Math.round(e.cargoLf * 100)}%</dd>` : ''}
        <dt>${t('Flyets resultat')}</dt><dd class="mono ${e.profit >= 0 ? 'good' : 'bad'}">${money(perMin(e.profit))}/min</dd>
        <dt>${t('Ændring for selskabet')}</dt><dd class="mono ${r.delta >= 0 ? 'good' : 'bad'}">${r.delta >= 0 ? '+' : ''}${money(perMin(r.delta))}/min</dd>
      </dl>
      <button class="primary wide" data-route-to="${a.id}"><i class="fa-solid fa-check"></i> ${t('Opret rute')}</button>`}`;
}

// ---------- route picking ----------
function startPick(id) {
  S.picking = S.state.fleet.find(a => a.id === id);
  const m = S.cat.AIRCRAFT[S.picking.model];
  const reach = Math.min(m.rangeKm, license().maxKm);
  showRange({ lat: S.picking.blat, lon: S.picking.blon }, reach);
  focus(S.picking.blat, S.picking.blon, 4);
  const b = $('#pick-banner');
  b.innerHTML = `<i class="fa-solid fa-route"></i> ${t('Vælg destination for {plane} fra {base} – klik en lufthavn inden for {km} km', { plane: m.name, base: S.picking.base_iata || S.picking.base_ident, km: reach })}
    <button data-cancel-pick>${t('Annullér')}</button>`;
  b.hidden = false;
}
function stopPick() { S.picking = null; showRange(null); $('#pick-banner').hidden = true; }

// ---------- builder & shop ----------
function openBuild(id) {
  const fleet = S.state.fleet.filter(a => a.base_id === id).map(a => {
    const m = S.cat.AIRCRAFT[a.model];
    return { size: m.size, cargo: m.cat === 'cargo' };
  });
  openBuilder($('#modal'), {
    airport: S.state.owned.find(o => o.id === id), catalog: S.cat, toast, fleet, color: S.state.user.color,
    onChange: async aid => { await refresh(); return S.state.owned.find(o => o.id === aid); },
  });
}

let shopCat = 'turboprop';
function openPlaneShop(baseId) {
  const el = $('#modal');
  const render = () => {
    const base = S.state.owned.find(o => o.id === baseId), cash = liveCash(), lic = S.state.user.license;
    const models = Object.entries(S.cat.AIRCRAFT).filter(([, m]) => m.cat === shopCat).sort((a, b) => a[1].price - b[1].price);
    el.innerHTML = `<div class="shop card">
      <header><h2>${t('Køb fly')}</h2>
        <label class="base-select">${t('Base')} <select id="shop-base">${S.state.owned.map(o => `<option value="${o.id}" ${o.id === baseId ? 'selected' : ''}>${esc(code(o))} – ${esc(o.name)} (${fmt.format(o.runway_eff)} m)</option>`).join('')}</select></label>
        <button class="icon" data-close aria-label="${t('Luk')}"><i class="fa-solid fa-xmark"></i></button></header>
      <nav class="shop-tabs">${Object.entries(S.cat.CATEGORIES).map(([k, l]) => `<button data-cat="${k}" class="${k === shopCat ? 'active' : ''}">${t(l)}</button>`).join('')}</nav>
      <div class="shop-grid">${models.map(([k, m]) => {
        const checks = [
          [lic >= m.license, t('Licens: {name}', { name: S.cat.LICENSES[m.license].name })],
          [base.runway_eff >= m.runwayM, t('Bane {m} m', { m: m.runwayM })],
          ...m.req.map(r => [hasBuilding(base.stats, r), r === 'cargo' ? t('Fragtterminal') : bname(r)]),
          [true, m.cat === 'cargo' ? t('Fragtstand klasse {size}', { size: m.size }) : t('Gate klasse {size}', { size: m.size })],
        ];
        const ok = checks.every(c => c[0]) && cash >= m.price;
        return `<div class="plane ${ok ? '' : 'off'}">
          <div class="plane-head"><b>${m.name}</b><span class="badge">${m.cat === 'cargo' ? t('Stand') : 'Gate'} ${m.size}</span></div>
          <div class="specs mono">
            ${m.seats ? `<span><i class="fa-solid fa-chair"></i> ${t('{n} sæder', { n: m.seats })}</span>` : `<span><i class="fa-solid fa-box"></i> ${fmt1.format(m.payloadT)} t</span>`}
            <span><i class="fa-solid fa-arrows-left-right"></i> ${fmt.format(m.rangeKm)} km</span>
            <span><i class="fa-solid fa-gauge-high"></i> ${m.speedKmh} km/t</span><span><i class="fa-solid fa-gas-pump"></i> ${fmt.format(m.fuelKgH)} kg/t</span></div>
          <ul class="checks">${checks.map(([pass, txt]) => `<li class="${pass ? 'ok' : 'no'}"><i class="fa-solid ${pass ? 'fa-check' : 'fa-xmark'}"></i> ${txt}</li>`).join('')}</ul>
          <button class="primary wide" data-model="${k}" ${ok ? '' : 'disabled'}>${money(m.price)}</button>
        </div>`;
      }).join('')}</div></div>`;
    el.querySelector('#shop-base').onchange = e => { baseId = +e.target.value; render(); };
  };
  el.onmousemove = null;
  el.onclick = async e => {
    if (e.target.closest('[data-close]') || e.target === el) return (el.hidden = true);
    const c = e.target.closest('[data-cat]');
    if (c) { shopCat = c.dataset.cat; return render(); }
    const b = e.target.closest('[data-model]');
    if (!b) return;
    try { await api('/aircraft', { model: b.dataset.model, base_id: baseId }); toast(t('Fly købt – giv det en rute under Flåde')); await refresh(); render(); }
    catch (err) { toast(err.message, 'bad'); }
  };
  render();
  el.hidden = false;
}

// ---------- public profiles ----------
$('#panel').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.profile) openProfile(+e.target.dataset.profile); });

async function openProfile(id) {
  const el = $('#modal');
  el.onmousemove = null;
  el.onclick = e => { if (e.target.closest('[data-close]') || e.target === el) el.hidden = true; };
  let p;
  try { p = await api('/users/' + id); } catch (err) { return toast(err.message, 'bad'); }
  const mine = id === S.state.user.id;
  const planes = p.fleet.reduce((s, f) => s + f.n, 0);
  el.innerHTML = `<div class="profile card">
    <header><div class="profile-head">${avatar(p, 'lg')}
      <div><h2>${esc(p.company)}${mine ? ` <span class="badge">${t('Dig')}</span>` : ''}</h2>
        <p class="muted small">@${esc(p.username)} · ${t(S.cat.LICENSES[p.license].name)} · ${t('grundlagt {date}', { date: new Date(p.created_at).toLocaleDateString(locale()) })}</p>
        ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}</div></div>
      <button class="icon" data-close aria-label="${t('Luk')}"><i class="fa-solid fa-xmark"></i></button></header>
    <div class="profile-body">
      <div class="kpis four">
        <div><span>${t('Placering')}</span><b class="mono">#${p.rank} <small class="muted">${t('af {n}', { n: p.players })}</small></b></div>
        <div><span>${t('Selskabsværdi')}</span><b class="mono">${money(p.value)}</b></div>
        <div><span>${t('Lufthavne')}</span><b class="mono">${p.airports.length}</b></div>
        <div><span>${t('Fly · ruter')}</span><b class="mono">${planes} · ${p.routes.length}</b></div>
      </div>
      ${p.bankruptcies ? `<p class="small muted"><i class="fa-solid fa-gavel"></i> ${t('Konkurser')}: <b>${p.bankruptcies}</b></p>` : ''}
      <section><h3>${t('Lufthavne')}</h3>${p.airports.length ? `<div class="list">${p.airports.map(a => `
        <button class="row" data-goto="${a.id}" data-lat="${a.lat}" data-lon="${a.lon}">
          <b class="mono">${flag(a.country)} ${esc(code(a))}</b><span>${esc(a.name)}</span><span class="muted">${t('{n} fly', { n: a.based })}</span></button>`).join('')}</div>`
        : `<p class="muted">${t('Ingen endnu')}</p>`}</section>
      <section><h3>${t('Flåde')}</h3>${p.fleet.length ? `<div class="chips">${p.fleet.map(f => `<span class="chip">${f.n}× ${esc(S.cat.AIRCRAFT[f.model]?.name || f.model)}</span>`).join('')}</div>`
        : `<p class="muted">${t('Ingen fly endnu')}</p>`}</section>
      <section><h3>${t('Ruter')}</h3>${p.routes.length ? `<div class="chips">${p.routes.map(r => `<span class="chip mono">${esc(r.base_iata || r.base_ident)} ⇄ ${esc(r.dest_iata || r.dest_ident)}${r.planes > 1 ? ` ×${r.planes}` : ''}</span>`).join('')}</div>`
        : `<p class="muted">${t('Ingen ruter endnu')}</p>`}</section>
    </div></div>`;
  el.hidden = false;
}

// ---------- my page (settings) ----------
$('#my-page').onclick = () => { location.hash = '#/me'; };
window.addEventListener('hashchange', () => route());
function route() {
  if (!S.started) return;
  const on = location.hash === '#/me';
  $('#page').hidden = !on;
  if (on) renderMyPage();
}

// Crop to a centred square and scale to 256 px before upload.
async function squareImage(file) {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height), c = Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
  c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  const blob = await new Promise(r => c.toBlob(r, 'image/webp', 0.88));
  return blob?.type === 'image/webp' ? blob : new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
}

async function renderMyPage() {
  const u = S.state.user, tot = S.state.totals;
  const p = await api('/users/' + u.id);
  const el = $('#page');
  el.innerHTML = `
    <div class="page-inner">
      <header class="page-head">
        <button class="ghost-btn" data-back><i class="fa-solid fa-arrow-left"></i> ${t('Tilbage til kortet')}</button>
        <h1>${t('Min side')}</h1>
        <button data-profile="${u.id}"><i class="fa-solid fa-eye"></i> ${t('Vis min offentlige profil')}</button>
      </header>

      <div class="page-hero card">
        <div class="avatar-edit">${avatar(u, 'xl')}
          <label class="avatar-btn" data-i18n-title="Upload billede"><i class="fa-solid fa-camera"></i><input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp" hidden></label></div>
        <div><h2>${esc(u.company)}</h2><p class="muted">@${esc(u.username)} · ${t(license().name)} · #${p.rank} ${t('af {n}', { n: p.players })}</p>
          ${u.avatar_ver ? `<button class="ghost-btn small" data-avatar-remove><i class="fa-solid fa-trash"></i> ${t('Fjern billede')}</button>` : ''}</div>
        <div class="kpis four">
          <div><span>${t('Selskabsværdi')}</span><b class="mono">${money(u.value)}</b></div>
          <div><span>${t('Erfaringspoint')}</span><b class="mono">${fmt.format(u.xp)}</b></div>
          <div><span>${t('Fly · ruter')}</span><b class="mono">${S.state.fleet.length} · ${p.routes.length}</b></div>
          <div><span>${t('Resultat / min')}</span><b class="mono ${tot.profit >= 0 ? 'good' : 'bad'}">${money(perMin(tot.profit))}</b></div>
        </div>
      </div>

      <div class="page-grid">
        <form class="card form" id="form-profile">
          <h3>${t('Profil')}</h3>
          <label>${t('Selskabsnavn')}<input name="company" value="${esc(u.company)}" maxlength="40" required></label>
          <label>${t('Om selskabet')}<textarea name="bio" maxlength="200" rows="3" placeholder="${t('Fortæl andre piloter om dit flyselskab …')}">${esc(u.bio)}</textarea></label>
          <fieldset><legend>${t('Selskabsfarve')}</legend>
            <div class="swatches">${COLORS.map(c => `<label class="sw" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === u.color ? 'checked' : ''}><span></span></label>`).join('')}
              <label class="sw custom" title="${t('Egen farve')}"><input type="color" name="custom" value="${u.color}"></label></div></fieldset>
          <button class="primary" type="submit">${t('Gem profil')}</button>
        </form>

        <section class="card form">
          <h3>${t('Sprog')}</h3>
          <label>${t('Sprog i spillet')}<select id="lang-select">${langOptions()}</select></label>
          <p class="muted small">${t('Gemmes på din konto, så det følger dig på alle enheder.')}</p>
          <h3>${t('Statistik')}</h3>
          <dl class="ledger">
            <dt>${t('Lufthavne')}</dt><dd class="mono">${S.state.owned.length}</dd>
            <dt>${t('Passagerer pr. minut')}</dt><dd class="mono">${fmt.format(perMin(tot.pax))}</dd>
            <dt>${t('Fragt pr. minut')}</dt><dd class="mono">${fmt1.format(perMin(tot.cargoT))} t</dd>
            <dt>${t('Lån')}</dt><dd class="mono">${money(u.debt)}</dd>
          </dl>
        </section>

        <form class="card form" id="form-password">
          <h3>${t('Sikkerhed')}</h3>
          <label>${t('Nuværende adgangskode')}<input type="password" name="current" autocomplete="current-password" required></label>
          <label>${t('Ny adgangskode')}<input type="password" name="next" autocomplete="new-password" minlength="8" required></label>
          <label>${t('Gentag ny adgangskode')}<input type="password" name="repeat" autocomplete="new-password" minlength="8" required></label>
          <button class="primary" type="submit">${t('Skift adgangskode')}</button>
          <button type="button" data-logout-all><i class="fa-solid fa-right-from-bracket"></i> ${t('Log ud på alle andre enheder')}</button>
        </form>

        <form class="card form danger-zone" id="form-delete">
          <h3>${t('Slet konto')}</h3>
          <p class="muted small">${t('Sletter dit selskab, dine fly, lufthavne og al historik permanent. Det kan ikke fortrydes.')}</p>
          <label>${t('Adgangskode')}<input type="password" name="password" autocomplete="current-password" required></label>
          <button class="danger-solid" type="submit"><i class="fa-solid fa-triangle-exclamation"></i> ${t('Slet min konto permanent')}</button>
        </form>
      </div>
    </div>`;
  translateDom(el);
  const reload = async msg => { toast(msg); await refresh(); renderMyPage(); };

  el.querySelector('[data-back]').onclick = () => { location.hash = ''; };
  el.querySelector('#lang-select').onchange = e => changeLang(e.target.value, true);
  el.querySelector('#avatar-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try { await upload('/me/avatar', await squareImage(file)); reload(t('Profilbilledet er opdateret')); }
    catch (err) { toast(err.message || t('Billedet kunne ikke læses'), 'bad'); }
  };
  el.querySelector('[data-avatar-remove]')?.addEventListener('click', () =>
    api('/me/avatar/delete', {}).then(() => reload(t('Profilbilledet er fjernet')), err => toast(err.message, 'bad')));
  const custom = el.querySelector('input[name=custom]');
  custom.oninput = () => {
    el.querySelectorAll('input[name=color]').forEach(r => (r.checked = false));
    custom.dataset.picked = '1';
  };
  el.querySelectorAll('input[name=color]').forEach(r => (r.onchange = () => delete custom.dataset.picked));
  el.querySelector('#form-profile').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const color = custom.dataset.picked ? custom.value : f.get('color') || u.color;
    try { await api('/me', { company: f.get('company'), bio: f.get('bio'), color }); reload(t('Profilen er gemt')); }
    catch (err) { toast(err.message, 'bad'); }
  };
  el.querySelector('#form-password').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.next !== f.repeat) return toast(t('De to nye adgangskoder er ikke ens'), 'bad');
    try { await api('/me/password', { current: f.current, next: f.next }); e.target.reset(); toast(t('Adgangskoden er skiftet. Andre enheder er logget ud.')); }
    catch (err) { toast(err.message, 'bad'); }
  };
  el.querySelector('[data-logout-all]').onclick = () =>
    api('/me/logout-all', {}).then(() => toast(t('Du er logget ud på alle andre enheder')), err => toast(err.message, 'bad'));
  el.querySelector('#form-delete').onsubmit = async e => {
    e.preventDefault();
    if (!confirm(t('Er du helt sikker? Alt bliver slettet.'))) return;
    try { await api('/me/delete', { password: e.target.password.value }); setToken(null); location.hash = ''; location.reload(); }
    catch (err) { toast(err.message, 'bad'); }
  };
}

// ---------- search ----------
let searchTimer;
$('#search').oninput = e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const list = await api('/airports/search?q=' + encodeURIComponent(e.target.value.trim()));
    $('#search-results').innerHTML = list.map(a => `<button data-search="${a.id}" data-lat="${a.lat}" data-lon="${a.lon}">
      <b class="mono">${esc(code(a))}</b> ${esc(a.name)} <span class="muted">${flag(a.country)} ${esc(a.city)}</span></button>`).join('');
  }, 200);
};
$('#search-results').onclick = e => {
  const b = e.target.closest('[data-search]');
  if (!b) return;
  focus(+b.dataset.lat, +b.dataset.lon, 9);
  openDetail(+b.dataset.search);
  $('#search-results').innerHTML = '';
  $('#search').value = '';
};

// ---------- boot ----------
await setLang(initialLang());
applyLocale();
$('#auth-lang').innerHTML = langOptions();
S.cat = await api('/catalog');
if (hasToken()) enter().catch(() => { setToken(null); location.reload(); });
