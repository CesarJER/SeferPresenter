import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { i18nOptions, isLocale, locales, readPreference, resolveLocale, savePreference, uiI18n } from './runtime';
import type { Locale, UiRole } from './runtime';

const languageNames = { es: 'Español', en: 'English', fr: 'Français', he: 'עברית' };

const LanguagePicker = ({ role, supported }: { role: UiRole; supported: readonly Locale[] }) => {
  const { t, i18n } = useTranslation('common');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const locale = isLocale(i18n.language) ? i18n.language : 'es';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'he' ? 'rtl' : 'ltr';
  }, [locale]);
  const changeLocale = async (next: Locale) => {
    setBusy(true);
    setFailed(false);
    try {
      const namespaces = Object.keys(i18n.services.resourceStore.data.es || {});
      const { loadCatalog } = await import('./runtime');
      // Verify the new resources before changing language; an uncached offline choice keeps the current UI.
      const resources = await Promise.all(namespaces.map(async ns => [ns, await loadCatalog(next, ns)] as const));
      for (const [ns, resource] of resources) i18n.addResourceBundle(next, ns, resource);
      await i18n.changeLanguage(next);
      try { savePreference(window.localStorage, role, next); } catch { /* Restricted storage. */ }
    } catch {
      setFailed(true);
    } finally { setBusy(false); }
  };
  return <div className="ui-language-picker hidden fixed top-2 start-2 z-100 max-w-[45vw] rounded-md border border-slate-500 bg-slate-950/95 p-1 text-xs text-white shadow-md">
    <label className="flex items-center gap-1">
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t('language', { defaultValue: 'Idioma de la interfaz' })}</span>
      <select aria-label={t('language', { defaultValue: 'Idioma de la interfaz' })} value={locale} disabled={busy}
        className="max-w-full bg-slate-950 p-1" onChange={event => void changeLocale(event.target.value as Locale)}>
        {supported.map(item => <option key={item} value={item} lang={item} dir={item === 'he' ? 'rtl' : 'ltr'}>{languageNames[item]}</option>)}
      </select>
    </label>
    {failed && <p role="status">{t('loadFailed', { defaultValue: 'No se pudo cargar el idioma. Se conserva el actual.' })}</p>}
  </div>;
};

export const UiLocaleProvider = ({ role, children }: { role: UiRole; children: ReactNode }) => {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState<readonly Locale[]>(locales);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    void (async () => {
      let config: unknown = null;
      try {
        const response = await fetch('/api/public-config', { signal: controller.signal, cache: 'no-store' });
        if (response.ok) config = await response.json();
      } catch { /* Offline and older servers use Spanish. */ }
      finally { clearTimeout(timeout); }
      if (!active) return;
      const validLocale = resolveLocale(null, config);
      const configuration = (config as { i18n?: { defaultLocale?: unknown; supportedLocales?: unknown } })?.i18n;
      const candidate = configuration?.supportedLocales;
      const enabled = Array.isArray(candidate) && candidate.length > 0 && candidate.every(isLocale)
        && isLocale(configuration?.defaultLocale) && candidate.includes(configuration.defaultLocale)
        && candidate.includes('es') && candidate.includes(validLocale) ? candidate : locales;
      setSupported(enabled);
      let preference: unknown = null;
      try { preference = readPreference(window.localStorage, role); } catch { /* Restricted storage. */ }
      let locale = resolveLocale(preference, config);
      try {
        const { loadCatalog } = await import('./runtime');
        await loadCatalog(locale, 'common');
      } catch { locale = 'es'; }
      await uiI18n.init({ ...i18nOptions, lng: locale });
      if (active) setReady(true);
    })();
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [role]);
  if (!ready) return <p role="status" lang="es" dir="ltr">Cargando…</p>;
  return <I18nextProvider i18n={uiI18n}>
    <LanguagePicker role={role} supported={supported} />
    {children}
  </I18nextProvider>;
};
