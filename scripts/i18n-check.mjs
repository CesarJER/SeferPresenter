import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { parseSource, sourceFiles, uiLiterals } from './i18n-source.mjs'

export const LOCALES = ['es', 'en', 'fr', 'he']
export const variables = text => [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)]
  .map(match => match[1].split(',')[0].trim()).sort()
export const readCatalogs = (root = 'src/i18n/locales') => Object.fromEntries(LOCALES.map(locale => [locale,
  Object.fromEntries(fs.readdirSync(path.join(root, locale)).filter(file => file.endsWith('.json'))
    .map(file => [file.slice(0,-5), JSON.parse(fs.readFileSync(path.join(root, locale, file), 'utf8'))])),
]))

export const validateCatalogs = catalogs => {
  const errors = [], warnings = []
  const canonical = catalogs.en || {}
  for (const locale of LOCALES) {
    for (const [ns, source] of Object.entries(canonical)) {
      const target = catalogs[locale]?.[ns]
      if (!target || typeof target !== 'object' || Array.isArray(target)) {
        (locale === 'es' ? errors : warnings).push(`${locale}/${ns}: missing namespace`)
        continue
      }
      for (const [key, value] of Object.entries(source)) {
        const id = `${locale}/${ns}:${key}`
        if (typeof value !== 'string' || !value.trim()) { errors.push(`${id}: invalid canonical value`); continue }
        if (!(key in target)) { (locale === 'es' ? errors : warnings).push(`${id}: missing translation`); continue }
        const translated = target[key]
        if (typeof translated !== 'string' || !translated.trim()) { errors.push(`${id}: invalid translation`); continue }
        if (JSON.stringify(variables(value)) !== JSON.stringify(variables(translated))) errors.push(`${id}: incompatible interpolation`)
        if (/<\/?[a-z][^>]*>/i.test(translated)) errors.push(`${id}: HTML is not permitted; render markup in React`)
        const plural = /_(zero|one|two|few|many|other)$/.exec(key)
        if (plural) {
          const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories
          if (!categories.includes(plural[1]) && plural[1] !== 'zero') errors.push(`${id}: unsupported plural category`)
          for (const category of categories) {
            if (!(key.slice(0,-plural[0].length)+'_'+category in target)) errors.push(`${id}: missing plural category ${category}`)
          }
        }
      }
      for (const key of Object.keys(target)) {
        const base = key.replace(/_(zero|one|two|few|many|other)$/, '')
        const pluralSource = Object.keys(source).find(candidate => candidate !== base && candidate.replace(/_(zero|one|two|few|many|other)$/, '') === base)
        if (!(key in source) && !pluralSource) warnings.push(`${locale}/${ns}:${key}: obsolete key`)
        if (!(key in source) && pluralSource) {
          const value = target[key]
          const suffix = key.slice(base.length + 1)
          if (!new Intl.PluralRules(locale).resolvedOptions().pluralCategories.includes(suffix) && suffix !== 'zero') errors.push(`${locale}/${ns}:${key}: unsupported plural category`)
          if (typeof value !== 'string' || JSON.stringify(variables(source[pluralSource])) !== JSON.stringify(variables(value))) errors.push(`${locale}/${ns}:${key}: incompatible interpolation`)
        }
      }
    }
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}

export const inspectSource = (files = sourceFiles()) => {
  const literals = [], references = [], dynamic = []
  for (const file of files) {
    const ast = parseSource(file)
    for (const { text, line } of uiLiterals(ast)) literals.push({ file: file.replaceAll('\\','/'), line, text })
    const visit = node => {
      if (ts.isCallExpression(node) && /^(?:translate|t)$/.test(node.expression.getText(ast))) {
        const key = node.arguments[0]
        if (key && ts.isStringLiteral(key)) references.push(key.text)
        else dynamic.push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1 })
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return { literals, references, dynamic }
}

export const check = () => {
  let catalogs
  try { catalogs = readCatalogs() } catch(error) { return { errors:[`Malformed catalog: ${error.message}`], warnings:[] } }
  const result = validateCatalogs(catalogs)
  const source = inspectSource()
  const baseline = JSON.parse(fs.readFileSync('i18n/source-baseline.json', 'utf8'))
  for (const item of source.literals) {
    const known = baseline.some(entry => entry.file === item.file && entry.text === item.text)
    if (!known) result.warnings.push(`${item.file}:${item.line}: untranslated UI ${JSON.stringify(item.text)}`)
  }
  for (const ref of new Set(source.references)) {
    if (!ref.includes(':')) continue
    const [ns, key] = ref.split(':')
    if (!(key in (catalogs.en[ns] || {})) && !(key+'_other' in (catalogs.en[ns] || {}))) result.warnings.push(`${ref}: missing canonical key`)
  }
  for (const [ns, catalog] of Object.entries(catalogs.en)) for (const key of Object.keys(catalog)) {
    if (ns === 'common' && /^(language|loadFailed|items_)/.test(key)) continue
    if (!source.references.includes(`${ns}:${key}`) && !source.references.includes(`${ns}:${key.replace(/_(zero|one|two|few|many|other)$/, '')}`)) result.warnings.push(`${ns}:${key}: unused key (check dynamic use)`)
  }
  result.dynamic = source.dynamic.length
  result.baselined = baseline.length
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = check()
  for (const warning of result.warnings) console.warn(`::warning::${warning}`)
  for (const error of result.errors) console.error(`::error::${error}`)
  console.log(JSON.stringify({ errors:result.errors.length, warnings:result.warnings.length, dynamic:result.dynamic, baselined:result.baselined }))
  if (result.errors.length) process.exitCode=1
}
