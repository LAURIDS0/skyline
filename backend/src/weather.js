// Live hub weather from Open-Meteo (free, no key). Cached 30 min; a stale entry triggers a background refresh.
const cache = new Map();
const TTL = 30 * 60_000;

export function hubWeather(id, lat, lon) {
  const c = cache.get(id);
  if (!c || Date.now() - c.at > TTL) {
    cache.set(id, { at: Date.now(), data: c?.data ?? null });
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,weather_code`)
      .then(r => r.json())
      .then(({ current: w }) => cache.set(id, { at: Date.now(), data: { temp: w.temperature_2m, wind: w.wind_speed_10m, code: w.weather_code } }))
      .catch(() => {});
  }
  return c?.data ?? null;
}
