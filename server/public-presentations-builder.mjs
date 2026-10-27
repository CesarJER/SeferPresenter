import fs from 'fs'
import path from 'path'
import { createHash } from 'node:crypto'

const metadataCache = new Map()
const bookVersesCache = new Map()

const getMetadata = (publicDataDir) => {
  if (!publicDataDir) return {}
  try {
    const content = fs.readFileSync(path.join(publicDataDir, 'metadata.json'), 'utf-8').replace(/^\uFEFF/, '')
    const cached = metadataCache.get(publicDataDir)
    if (cached?.content === content) return cached.metadata
    const metadata = JSON.parse(content)
    metadataCache.set(publicDataDir, { content, metadata })
    return metadata
  } catch (err) {
    console.error('Error reading metadata.json:', err)
    metadataCache.delete(publicDataDir)
    return {}
  }
}

const resolveSafeFile = (metadata, bookAbbrev) => {
  for (const book of Object.values(metadata)) {
    if (book.bookAbbrevEs === bookAbbrev || book.bookHeb === bookAbbrev) {
      return book.safeFile
    }
  }
  return null
}

const getBookChapters = (publicDataDir, safeFile) => {
  const filePath = path.join(publicDataDir, 'books', `${safeFile}.tsv`)
  const tsvContent = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  const cached = bookVersesCache.get(filePath)
  if (cached?.content === tsvContent) return cached.chapters

  const lines = tsvContent.split('\n')
  const chapters = new Map()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split('\t')
    if (parts.length < 8) continue
    const chapterKey = parts[3]
    const verseNum = parseInt(parts[4], 10)
    if (Number.isNaN(verseNum)) continue
    let list = chapters.get(chapterKey)
    if (!list) {
      list = []
      chapters.set(chapterKey, list)
    }
    list.push({ verse: verseNum, texts: [parts[5], parts[6], parts[7]] })
  }

  bookVersesCache.set(filePath, { content: tsvContent, chapters })
  return chapters
}

const loadVersesForRange = (publicDataDir, metadata, books, bookAbbrev, chapter, verseStart, verseEnd) => {
  const safeFile = resolveSafeFile(metadata, bookAbbrev)
  if (!safeFile) return null
  try {
    if (!books.has(safeFile)) books.set(safeFile, getBookChapters(publicDataDir, safeFile))
    const chapters = books.get(safeFile)
    const chapterVerses = chapters.get(String(chapter))
    if (!chapterVerses) return null
    const start = parseInt(verseStart, 10)
    const end = verseEnd ? parseInt(verseEnd, 10) : start
    const verses = []

    for (const item of chapterVerses) {
      if (item.verse >= start && item.verse <= end) {
        verses.push(item.texts)
      }
    }
    return verses.length > 0 ? verses : null
  } catch (err) {
    console.error(`Error loading verses for ${bookAbbrev} (${safeFile}):`, err)
    return null
  }
}

const isPublicSlide = (slide) => slide && typeof slide === 'object' &&
  slide.type !== 'quiz' && slide.type !== 'media' &&
  !(typeof slide.label === 'string' && (slide.label.includes('[IMAGE]') || slide.label.includes('[MEDIA]')))

// Fingerprint the same configured sources used by projection, including private overrides.
export const getPublicPresentationsSourcesRevision = (presentations, catalogs, { publicDataDir } = {}) => {
  const hash = createHash('sha256').update(JSON.stringify(catalogs))
  if (!publicDataDir) return hash.digest('hex')
  const allowedTags = new Set(catalogs.flatMap(catalog => catalog.tags || []))
  const books = new Set()
  for (const presentation of presentations) {
    if (!presentation?.tags?.some(tag => allowedTags.has(tag))) continue
    for (const slide of presentation.slides || []) {
      if (!isPublicSlide(slide) || !['tanaj', 'sefer'].includes(slide.type) || !slide.scriptureBook || !slide.scriptureChapter || !slide.scriptureVerseStart) continue
      books.add(slide.scriptureBook)
    }
  }
  if (books.size === 0) return hash.digest('hex')
  const metadata = getMetadata(publicDataDir)
  hash.update(metadataCache.get(publicDataDir)?.content ?? 'unavailable')
  const files = new Set([...books].map(book => resolveSafeFile(metadata, book)).filter(Boolean))
  for (const safeFile of files) {
    try {
      hash.update(JSON.stringify([safeFile, fs.readFileSync(path.join(publicDataDir, 'books', `${safeFile}.tsv`), 'utf8')]))
    } catch (error) {
      hash.update(JSON.stringify([safeFile, error.code]))
    }
  }
  return hash.digest('hex')
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
  let metadata
  const books = new Map()

  for (const pres of presentations) {
    if (!pres || typeof pres !== 'object') continue

    const presTags = Array.isArray(pres.tags) ? pres.tags : []
    const hasPublicTag = presTags.some(tag => allowedTags.has(tag))

    if (!hasPublicTag) continue

    const cleanSlides = (pres.slides || [])
      .filter(isPublicSlide)
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
          metadata ??= getMetadata(publicDataDir)
          const verses = loadVersesForRange(
            publicDataDir,
            metadata,
            books,
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
