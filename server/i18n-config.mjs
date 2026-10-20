import fs from 'node:fs'

export const SUPPORTED_LOCALES = Object.freeze(['es', 'en', 'fr', 'he'])
export const normalizeI18nConfig = (value) => {
  const config = value?.i18n
  const supportedLocales = config?.supportedLocales
  const valid = config && SUPPORTED_LOCALES.includes(config.defaultLocale)
    && Array.isArray(supportedLocales) && supportedLocales.length > 0
    && supportedLocales.every(locale => SUPPORTED_LOCALES.includes(locale))
    && supportedLocales.includes(config.defaultLocale) && supportedLocales.includes('es')
  return { i18n: valid
    ? { defaultLocale: config.defaultLocale, supportedLocales: [...new Set(supportedLocales)] }
    : { defaultLocale: 'es', supportedLocales: [...SUPPORTED_LOCALES] } }
}

export const loadI18nConfig = (filePath) => {
  try {
    if (fs.statSync(filePath).size > 16_384) return normalizeI18nConfig(null)
    return normalizeI18nConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')))
  } catch {
    return normalizeI18nConfig(null)
  }
}
