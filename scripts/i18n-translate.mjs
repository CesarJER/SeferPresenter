import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LOCALES, readCatalogs, validateCatalogs } from './i18n-check.mjs'

export const fingerprint = ({ key, text, sourceLocale, targetLocale, context, settings }) => createHash('sha256')
  .update(JSON.stringify({ key, text, sourceLocale, targetLocale, context, settings })).digest('hex')

const technicalTokens = text => [...new Set(text.match(/\b(?:CITA!?|P):|\b[\w.-]+\.(?:json|tsv|mp4|webm)\b|\[MEDIA\b/g) || [])]

export const planTranslations = ({ catalogs, manifest, settings = {}, maxCharacters = 10000, maxMessages = 100 }) => {
  if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0 || !Number.isSafeInteger(maxMessages) || maxMessages < 0) throw new Error('Invalid translation budget')
  const pending = [], protectedEntries = [], reviewRequired = []
  let characters = 0
  for (const [ns, source] of Object.entries(catalogs.en)) for (const [key, text] of Object.entries(source)) {
    const id = `${ns}:${key}`
    const entry = manifest[id] || { status: {} }
    for (const targetLocale of LOCALES.filter(locale => locale !== 'en')) {
      const input = { key:id, text, sourceLocale:'en', targetLocale, context:entry.context || ns, settings }
      const hash = fingerprint(input)
      const previous = entry.cache?.[targetLocale]
      const targetExists = typeof catalogs[targetLocale]?.[ns]?.[key] === 'string'
      if (previous === hash && targetExists) continue
      if (['reviewed','source'].includes(entry.status?.[targetLocale])) { protectedEntries.push({ key:id, targetLocale }); continue }
      if (entry.status?.en !== 'reviewed') { reviewRequired.push({ key:id, targetLocale }); continue }
      if (characters + text.length > maxCharacters || pending.length >= maxMessages) continue
      characters += text.length
      pending.push({ ...input, fingerprint:hash })
    }
  }
  return { pending, characters, protectedEntries, reviewRequired }
}

export const applyTranslations = async ({ catalogs, manifest, pending, provider, batchSize = 20 }) => {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('Invalid batch size')
  const nextCatalogs = structuredClone(catalogs), nextManifest = structuredClone(manifest)
  for (let offset=0; offset<pending.length; offset+=batchSize) {
    const batch = pending.slice(offset,offset+batchSize)
    const translated = await provider.translateBatch(batch)
    if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(value => typeof value !== 'string')) throw new Error('Invalid provider response')
    for (let i=0;i<batch.length;i++) {
      const message=batch[i], [ns,key]=message.key.split(':')
      if (technicalTokens(message.text).some(token => !translated[i].includes(token))) throw new Error(`Provider changed a technical identifier: ${message.key}`)
      if (['source','reviewed'].includes(nextManifest[message.key]?.status?.[message.targetLocale])) continue
      nextCatalogs[message.targetLocale][ns] ??= {}
      nextCatalogs[message.targetLocale][ns][key] = translated[i]
      const entry=nextManifest[message.key] ??= {sourceLocale:'en',context:message.context,status:{}}
      entry.status[message.targetLocale]='machine'
      entry.cache ??= {}; entry.cache[message.targetLocale]=message.fingerprint
    }
  }
  const result=validateCatalogs(nextCatalogs)
  if (result.errors.length) throw new Error(result.errors.join('\n'))
  return { catalogs:nextCatalogs, manifest:nextManifest }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const catalogs=readCatalogs(), manifest=JSON.parse(fs.readFileSync('i18n/review-status.json','utf8'))
  const settings={ provider:process.env.SEFER_TRANSLATION_PROVIDER_ID || 'unconfigured', revision:process.env.SEFER_TRANSLATION_SETTINGS_VERSION || '1' }
  const plan=planTranslations({catalogs,manifest,settings,maxCharacters:Number(process.env.SEFER_TRANSLATION_MAX_CHARACTERS || 10000),maxMessages:Number(process.env.SEFER_TRANSLATION_MAX_MESSAGES || 100)})
  fs.mkdirSync('tmp/i18n-translation',{recursive:true})
  fs.writeFileSync('tmp/i18n-translation/plan.json',JSON.stringify(plan,null,2)+'\n')
  console.log(JSON.stringify({pending:plan.pending.length,characters:plan.characters,protected:plan.protectedEntries.length,sourceReviewRequired:plan.reviewRequired.length}))
  if (process.argv.includes('--apply')) {
    const providerPath=process.env.SEFER_TRANSLATION_PROVIDER
    if (!providerPath) throw new Error('No provider configured. Only a plan was produced; no translations were changed.')
    const provider=await import(pathToFileURL(path.resolve(providerPath)).href)
    const output=await applyTranslations({catalogs,manifest,pending:plan.pending,provider,batchSize:Number(process.env.SEFER_TRANSLATION_BATCH_SIZE || 20)})
    // Provider output stays separate until a human reviews and copies the diff.
    for (const [locale,namespaces] of Object.entries(output.catalogs)) for (const [ns,values] of Object.entries(namespaces)) {
      const directory=`tmp/i18n-translation/locales/${locale}`;fs.mkdirSync(directory,{recursive:true})
      fs.writeFileSync(`${directory}/${ns}.json`,JSON.stringify(values,null,2)+'\n')
    }
    fs.writeFileSync('tmp/i18n-translation/review-status.json',JSON.stringify(output.manifest,null,2)+'\n')
  }
}
