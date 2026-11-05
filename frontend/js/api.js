import { t } from './i18n.js';

let token = null;
try { token = localStorage.getItem('token'); } catch {}

export const hasToken = () => !!token;
export function setToken(v) {
  token = v;
  try { v ? localStorage.setItem('token', v) : localStorage.removeItem('token'); } catch {}
}

async function request(path, init) {
  const res = await fetch('/api' + path, { ...init, headers: { ...init.headers, ...(token && { Authorization: 'Bearer ' + token }) } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== '/login') { setToken(null); location.reload(); }
  if (!res.ok) throw new Error(data.key ? t(data.key, data.params) : data.error || t('Noget gik galt'));
  return data;
}

export const api = (path, body) => request(path, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json' },
  body: body && JSON.stringify(body),
});

export const upload = (path, blob) => request(path, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob });

export const avatarUrl = u => `/api/users/${u.id}/avatar?v=${u.avatar_ver}`;

// Open-Meteo (free, no key) current weather.
const WMO = [[0, '☀️', 'Klart'], [3, '⛅', 'Skyet'], [48, '🌫️', 'Tåge'], [67, '🌧️', 'Regn'], [77, '🌨️', 'Sne'], [82, '🌦️', 'Byger'], [99, '⛈️', 'Torden']];
export async function weather(lat, lon) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code`);
  const { current: c } = await r.json();
  const [, icon, text] = WMO.find(([max]) => c.weather_code <= max) || WMO.at(-1);
  return { icon, text: t(text), temp: Math.round(c.temperature_2m), wind: Math.round(c.wind_speed_10m), dir: c.wind_direction_10m };
}
