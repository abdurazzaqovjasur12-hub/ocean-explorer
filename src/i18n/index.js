import { ref } from 'vue';
import uz from './locales/uz.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

/*
 * The app's one translation system. All interface text lives in ./locales/{uz,en,ru}.json and is reached by key:
 * `t('chapters.whale.title')`, with `{name}` placeholders filled from an object: `t('progress.chapter', { n, label })`.
 *
 * `locale` is a Vue ref, so every template that calls t() re-renders the moment the language changes. Nothing
 * else is touched: the 3D scene, the scroll position, the timelines, the camera, sound and quality all carry on.
 * The choice is remembered in localStorage; Uzbek is the default.
 */

export const LOCALES = ['uz', 'en', 'ru'];
export const DEFAULT_LOCALE = 'uz';
const messages = { uz, en, ru };
const STORAGE_KEY = 'ocean-explorer.locale';
// Uzbek groups thousands with spaces like Russian; not every browser ships Uzbek number data, so use ru-RU's.
const NUMBER_LOCALE = { uz: 'ru-RU', en: 'en-US', ru: 'ru-RU' };

function storedLocale() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LOCALES.includes(value) ? value : null;
  } catch {
    return null; // private mode, blocked storage
  }
}

export const locale = ref(storedLocale() ?? DEFAULT_LOCALE);

const lookup = (lang, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), messages[lang]);
const warned = new Set();

/** A message in a given language (falls back to English, then to the key itself, so a gap is visible, not blank). */
export function tFor(lang, key, params) {
  let value = lookup(lang, key);
  if (value == null) {
    value = lookup('en', key);
    if (import.meta.env?.DEV && !warned.has(`${lang}:${key}`)) {
      warned.add(`${lang}:${key}`);
      console.warn(`[i18n] missing "${key}" in ${lang}`);
    }
  }
  if (value == null) return key;
  if (typeof value === 'string' && params) {
    value = value.replace(/\{(\w+)\}/g, (match, name) => (params[name] ?? match));
  }
  return value;
}

/** A message in the current language. Reactive inside templates and computed values. */
export const t = (key, params) => tFor(locale.value, key, params);

/** Numbers grouped the local way: 10,900 (English), 10 900 (Uzbek, Russian). */
export const formatNumber = (n) => new Intl.NumberFormat(NUMBER_LOCALE[locale.value] ?? 'en-US').format(n);

function applyToDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale.value;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

/** Switch language: instantly, everywhere, without touching anything else. Remembered for the next visit. */
export function setLocale(lang) {
  if (!LOCALES.includes(lang) || lang === locale.value) return;
  locale.value = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* not remembered, still switched */
  }
  applyToDocument();
}

applyToDocument();
