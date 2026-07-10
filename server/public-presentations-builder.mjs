/**
 * Builds the public copy of presentations based on the loaded catalogs.
 *
 * @param {Array} presentations - The raw array of all presentations.
 * @param {Array} catalogs - The array of parsed public catalogs.
 * @returns {Array} A filtered and sanitized array of public presentations.
 */
export const buildPublicPresentations = (presentations, catalogs) => {
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
