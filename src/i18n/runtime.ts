import { createInstance } from 'i18next';
import type { BackendModule } from 'i18next';

export const locales = ['es', 'en', 'fr', 'he'] as const;
export type Locale = typeof locales[number];
export type UiRole = 'control' | 'presenter' | 'audience' | 'catalog' | 'audioEditor';
export const isLocale = (value: unknown): value is Locale => locales.includes(value as Locale);
const catalogs = import.meta.glob('./locales/*/*.json', { import: 'default' });
export const loadCatalog = async (locale: string, namespace: string) => {
  const loader = catalogs[`./locales/${locale}/${namespace}.json`];
  if (!loader) throw new Error('Translation catalog unavailable');
  return await loader() as Record<string, string>;
};
export const makeI18n = () => {
  const instance = createInstance();
  const backend: BackendModule = {
    type: 'backend', init() {},
    read(locale, namespace, callback) {
      loadCatalog(locale, namespace).then(data => callback(null, data), error => callback(error, false));
    },
  };
  instance.use(backend);
  return instance;
};
export const uiI18n = makeI18n();
export const storageKey = (role: UiRole) => `sefer.uiLocale.${role}`;
export const resolveLocale = (preference: unknown, config: unknown): Locale => {
  const candidate = (config as { i18n?: { defaultLocale?: unknown; supportedLocales?: unknown } })?.i18n;
  const enabled = candidate?.supportedLocales;
  const validConfig = Array.isArray(enabled) && enabled.length > 0 && enabled.every(isLocale)
    && enabled.includes('es') && isLocale(candidate?.defaultLocale) && enabled.includes(candidate.defaultLocale);
  const supported = validConfig ? enabled : locales;
  if (isLocale(preference) && supported.includes(preference)) return preference;
  return validConfig ? candidate.defaultLocale as Locale : 'es';
};
export const translate = (key: string, fallback: string, values: Record<string, unknown> = {}) => {
  if (!uiI18n.isInitialized) return fallback.replace(/{{\s*(\w+)\s*}}/g, (_, name) => String(values[name] ?? ''));
  return String(uiI18n.t(key, { ...values, defaultValue: fallback }));
};
export const i18nOptions = {
  fallbackLng: 'es', supportedLngs: [...locales], load: 'languageOnly' as const,
  keySeparator: false as const,
  defaultNS: 'common', ns: ['common'], interpolation: { escapeValue: false },
  returnNull: false, returnEmptyString: false, react: { useSuspense: false },
};

export const readPreference = (storage: Storage | undefined, role: UiRole) => {
  try { return storage?.getItem(storageKey(role)); } catch { return null; }
};
export const savePreference = (storage: Storage | undefined, role: UiRole, locale: Locale) => {
  try { storage?.setItem(storageKey(role), locale); } catch { /* Storage can be disabled. */ }
};
