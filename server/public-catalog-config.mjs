export const parsePublicCatalogs = (envJson) => {
  if (!envJson) return []
  try {
    const parsed = JSON.parse(envJson)
    if (!Array.isArray(parsed)) {
      console.error('[Public Catalogs] Error: SEFER_PUBLIC_CATALOGS_JSON must be an array')
      return []
    }

    const catalogs = []
    const ids = new Set()
    const paths = new Set()
    const reservedPaths = new Set([
      '/', '/audience', '/presenter', '/control', '/audio-editor', '/proteccion-datos'
    ])

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue

      const id = String(item.id || '').trim()
      let rawPath = String(item.path || '').trim()
      const title = String(item.title || '').trim()
      const description = item.description !== undefined ? String(item.description).trim() : undefined
      const rawTags = Array.isArray(item.tags) ? item.tags : []

      if (!id) {
        console.error('[Public Catalogs] Error: Catalog missing id')
        return []
      }
      if (!rawPath) {
        console.error(`[Public Catalogs] Error: Catalog '${id}' missing path`)
        return []
      }
      if (!title) {
        console.error(`[Public Catalogs] Error: Catalog '${id}' missing title`)
        return []
      }

      if (!rawPath.startsWith('/')) {
        rawPath = '/' + rawPath
      }
      // Normalize trailing slashes
      if (rawPath.length > 1 && rawPath.endsWith('/')) {
        rawPath = rawPath.slice(0, -1)
      }

      if (reservedPaths.has(rawPath)) {
        console.error(`[Public Catalogs] Error: Catalog '${id}' uses a reserved path '${rawPath}'`)
        return []
      }

      if (ids.has(id)) {
        console.error(`[Public Catalogs] Error: Duplicate catalog id '${id}'`)
        return []
      }
      if (paths.has(rawPath)) {
        console.error(`[Public Catalogs] Error: Duplicate catalog path '${rawPath}'`)
        return []
      }

      const tags = Array.from(new Set(
        rawTags
          .map(t => String(t).trim())
          .filter(t => t.length > 0)
      ))

      if (tags.length === 0) {
        console.error(`[Public Catalogs] Error: Catalog '${id}' must have at least one valid tag`)
        return []
      }

      ids.add(id)
      paths.add(rawPath)

      catalogs.push({
        id,
        path: rawPath,
        title,
        ...(description ? { description } : {}),
        tags
      })
    }

    return catalogs
  } catch (err) {
    console.error('[Public Catalogs] Invalid JSON in SEFER_PUBLIC_CATALOGS_JSON', err)
    return []
  }
}

let cachedCatalogs = null

export const getPublicCatalogs = () => {
  if (cachedCatalogs !== null) return cachedCatalogs
  cachedCatalogs = parsePublicCatalogs(process.env.SEFER_PUBLIC_CATALOGS_JSON)
  return cachedCatalogs
}
