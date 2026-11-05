// Danish is the source language: the Danish text is the key, and each lang/<code>.js maps it to a translation.
// Add a language: copy lang/en.js, translate the values, add it to LANGS (and to LANGS in backend/src/server.js).
export const LANGS = {
  da: { name: 'Dansk', locale: 'da-DK' },
  en: { name: 'English', locale: 'en-GB' },
  de: { name: 'Deutsch', locale: 'de-DE' },
  es: { name: 'Español', locale: 'es-ES' },
  fr: { name: 'Français', locale: 'fr-FR' },
  sv: { name: 'Svenska', locale: 'sv-SE' },
};

let dict = {}, lang = 'da';
export const getLang = () => lang;
export const locale = () => LANGS[lang].locale;

export function initialLang() {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch {}
  const nav = (navigator.language || 'da').slice(0, 2);
  return saved && LANGS[saved] ? saved : LANGS[nav] ? nav : 'en';
}

export async function setLang(code) {
  lang = LANGS[code] ? code : 'en';
  dict = lang === 'da' ? {} : (await import(`./lang/${lang}.js`)).default;
  document.documentElement.lang = lang;
  try { localStorage.setItem('lang', lang); } catch {}
  translateDom();
}

const num = v => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(v);
// String params are translated too (they are often catalog names); arrays are joined.
const param = v => (Array.isArray(v) ? v.map(param).join(', ') : typeof v === 'number' ? num(v) : dict[v] ?? v ?? '');

export const t = (key, params) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (params && k in params ? param(params[k]) : `{${k}}`));

export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => (el.textContent = t(el.dataset.i18n)));
  root.querySelectorAll('[data-i18n-ph]').forEach(el => (el.placeholder = t(el.dataset.i18nPh)));
  root.querySelectorAll('[data-i18n-title]').forEach(el => (el.title = el.ariaLabel = t(el.dataset.i18nTitle)));
}
