import { api } from './api.js';

const TYPE_STYLE = {
  large_airport: { radius: 6, color: '#7aa2ff' },
  medium_airport: { radius: 4, color: '#5d7bb5' },
  small_airport: { radius: 3, color: '#48618a' },
};
const ACCENT = '#f5b942';

export const map = L.map('map', { preferCanvas: true, worldCopyJump: true, zoomControl: false, minZoom: 2 }).setView([54, 10], 4);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const worldLayer = L.layerGroup().addTo(map);
const myLayer = L.layerGroup().addTo(map);
const airportLayer = L.layerGroup().addTo(map);
const pickLayer = L.layerGroup().addTo(map);
let myId = null, onSelect = () => {}, loadTimer;

export function initMap(opts) {
  ({ myId, onSelect } = opts);
  // CARTO basemaps need a (free) key; it comes from CARTO_KEY in .env via /api/catalog.
  L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${opts.tileKey}`, {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a> · Lufthavne: <a href="https://ourairports.com/">OurAirports</a> · Vejr: <a href="https://open-meteo.com/">Open-Meteo</a>',
    maxZoom: 18,
  }).addTo(map);
  map.on('moveend', () => { clearTimeout(loadTimer); loadTimer = setTimeout(loadAirports, 150); });
  loadAirports();
}

export async function loadAirports() {
  const b = map.getBounds();
  const list = await api(`/airports?s=${b.getSouth()}&w=${b.getWest()}&n=${b.getNorth()}&e=${b.getEast()}&z=${map.getZoom()}`);
  airportLayer.clearLayers();
  for (const a of list.reverse()) {
    const st = TYPE_STYLE[a.type], mine = a.owner_id === myId;
    L.circleMarker([a.lat, a.lon], {
      radius: st.radius + (a.owner_id ? 2 : 0),
      color: mine ? ACCENT : a.owner_color || st.color,
      fillColor: mine ? ACCENT : a.owner_color || st.color,
      fillOpacity: a.owner_id ? 0.95 : 0.6, weight: a.owner_id ? 2 : 1,
    }).bindTooltip(`<b>${a.iata || a.ident}</b> ${a.name}`, { direction: 'top', offset: [0, -4] })
      .on('click', () => onSelect(a.id))
      .addTo(airportLayer);
  }
}

// Great-circle points; longitudes unwrapped so antimeridian routes don't streak across the map.
export function arc(a, b, n = 48) {
  const r = Math.PI / 180, p1 = a[0] * r, l1 = a[1] * r, p2 = b[0] * r, l2 = b[1] * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!d) return [a, b];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    pts.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  for (let i = 1; i < pts.length; i++) {
    while (pts[i][1] - pts[i - 1][1] > 180) pts[i][1] -= 360;
    while (pts[i][1] - pts[i - 1][1] < -180) pts[i][1] += 360;
  }
  return pts;
}

export function drawWorld(routes) {
  worldLayer.clearLayers();
  for (const r of routes) {
    if (r.uid === myId) continue;
    L.polyline(arc([r.blat, r.blon], [r.dlat, r.dlon], 24), { color: r.color, weight: 1.2, opacity: 0.35, interactive: false }).addTo(worldLayer);
  }
}

let planes = [];
export function drawMyRoutes(fleet) {
  myLayer.clearLayers();
  planes = fleet.filter(a => a.dest_id && a.econ).map(a => {
    const pts = arc([a.blat, a.blon], [a.dlat, a.dlon]);
    L.polyline(pts, { color: ACCENT, weight: 2, opacity: 0.7, interactive: false }).addTo(myLayer);
    const marker = L.marker(pts[0], {
      icon: L.divIcon({ className: 'plane-icon', html: '<i class="fa-solid fa-plane"></i>', iconSize: [18, 18] }),
      interactive: false,
    }).addTo(myLayer);
    return { a, pts, marker };
  });
}

// Position each plane from the shared game clock: fly out, turnaround, fly back, turnaround.
export function animatePlanes(gameHours, turnaround) {
  for (const { a, pts, marker } of planes) {
    const flight = 1 / a.econ.legs - turnaround;
    const t = (gameHours + a.id * 0.37) % (2 / a.econ.legs);
    const leg = t < 1 / a.econ.legs ? 0 : 1;
    const u = Math.min(1, Math.max(0, (t - leg / a.econ.legs - turnaround / 2) / flight));
    const f = leg ? 1 - u : u;
    const i = Math.min(pts.length - 2, Math.floor(f * (pts.length - 1)));
    const k = f * (pts.length - 1) - i;
    const pos = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    marker.setLatLng(pos);
    const p1 = map.latLngToLayerPoint(pts[i]), p2 = map.latLngToLayerPoint(pts[i + 1]);
    const deg = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI + (leg ? 180 : 0);
    const el = marker.getElement()?.firstChild;
    if (el) { el.style.transform = `rotate(${deg}deg)`; el.style.opacity = u === 0 || u === 1 ? 0.4 : 1; }
  }
}

export function showRange(base, km) {
  pickLayer.clearLayers();
  if (base) L.circle([base.lat, base.lon], { radius: km * 1000, color: ACCENT, weight: 1, dashArray: '6 6', fillOpacity: 0.04, interactive: false }).addTo(pickLayer);
}

export const focus = (lat, lon, zoom = 8) => map.flyTo([lat, lon], Math.max(zoom, map.getZoom()), { duration: 0.8 });
