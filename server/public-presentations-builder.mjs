import fs from 'fs'
import path from 'path'
const metadataCache = new Map()
const getMetadata = (publicDataDir) => {
  if (!publicDataDir) return {}
  if (metadataCache.has(publicDataDir)) return metadataCache.get(publicDataDir)
  try {
    const content = fs.readFileSync(path.join(publicDataDir, 'metadata.json'), 'utf-8').replace(/^\uFEFF/, '')
    const metadata = JSON.parse(content)
    metadataCache.set(publicDataDir, metadata)
    return metadata
  } catch (err) {
    console.error('Error reading metadata.json:', err)
    metadataCache.set(publicDataDir, {})
    return {}
  }
}

const resolveSafeFile = (publicDataDir, bookAbbrev) => {
  const metadata = getMetadata(publicDataDir)
  for (const book of Object.values(metadata)) {
    if (book.bookAbbrevEs === bookAbbrev || book.bookHeb === bookAbbrev) {
      return book.safeFile
    }
  }
  return null
}

const loadVersesForRange = (publicDataDir, bookAbbrev, chapter, verseStart, verseEnd) => {
  const safeFile = resolveSafeFile(publicDataDir, bookAbbrev)
  if (!safeFile) return null
  try {
    const tsvContent = fs.readFileSync(path.join(publicDataDir, 'books', `${safeFile}.tsv`), 'utf-8').replace(/^\uFEFF/, '')
    const lines = tsvContent.split('\n')
    const start = parseInt(verseStart, 10)
    const end = verseEnd ? parseInt(verseEnd, 10) : start
    const verses = []
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const parts = line.split('\t')
      if (parts.length < 8) continue
      if (parts[3] === String(chapter)) {
        const v = parseInt(parts[4], 10)
        if (v >= start && v <= end) {
          verses.push([parts[5], parts[6], parts[7]])
        }
      }
    }
    return verses.length > 0 ? verses : null
  } catch (err) {
    console.error(`Error loading verses for ${bookAbbrev} (${safeFile}):`, err)
    return null
  }
}

/**
 * Builds the public copy of presentations based on the loaded catalogs.
 *
 * @param {Array} presentations - The raw array of all presentations.
 * @param {Array} catalogs - The array of parsed public catalogs.
 * @returns {Array} A filtered and sanitized array of public presentations.
 */
export const buildPublicPresentations = (presentations, catalogs, { publicDataDir } = {}) => {
  if (!Array.isArray(presentations) || !Array.isArray(catalogs)) return []

  const allowedTags = new Set(
    catalogs.flatMap(cat => cat.tags || [])
  )

  if (allowedTags.size === 0) return []

  const publicPresentations = []

  for (const pres of presentations) {
    if (!pres || typeof pres !== 'object') continue

    const presTags = Array.isArray(pres.tags) ? pres.tags : []
    const hasPublicTag = presTags.some(tag => allowedTags.has(tag))

    if (!hasPublicTag) continue

    const cleanSlides = (pres.slides || [])
      .filter(slide => {
        if (!slide || typeof slide !== 'object') return false
        if (slide.type === 'quiz' || slide.type === 'media') return false
        if (typeof slide.label === 'string' && (slide.label.includes('[IMAGE]') || slide.label.includes('[MEDIA]'))) return false
        return true
      })
      .map(slide => {
        // Strip private and media fields
        const {
          background,
          mediaSrc,
          mediaFit,
          mediaShowBg,
          mediaVolume,
          mediaSpeed,
          mediaLoop,
          mediaPresenterNav,
          mediaStart,
          mediaEnd,
          quizData,
          ...cleanSlide
        } = slide
        
        // Inject scripture verses if applicable
        if ((cleanSlide.type === 'tanaj' || cleanSlide.type === 'sefer') && cleanSlide.scriptureBook && cleanSlide.scriptureChapter && cleanSlide.scriptureVerseStart) {
          const verses = loadVersesForRange(
            publicDataDir,
            cleanSlide.scriptureBook,
            cleanSlide.scriptureChapter,
            cleanSlide.scriptureVerseStart,
            cleanSlide.scriptureVerseEnd
          )
          if (verses) {
            cleanSlide.scriptureVerses = verses
          }
        }
        
        return cleanSlide
      })

    publicPresentations.push({
      id: pres.id,
      title: pres.title,
      mode: pres.mode || 'standard',
      fontScale: pres.fontScale,
      tags: presTags.filter(t => allowedTags.has(t)),
      slides: cleanSlides
    })
  }

  return publicPresentations
}
