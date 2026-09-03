export const getStaticCacheHeaders = (requestPath = '', stat = null, ext = '') => {
  const pathname = String(requestPath).toLowerCase()
  if (
    pathname === '/proteccion-datos' ||
    pathname.startsWith('/proteccion-datos/') ||
    pathname.startsWith('/legal/')
  ) {
    return {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    }
  }
  if (pathname.startsWith('/assets/')) {
    return {
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
  }
  if (pathname.startsWith('/audio/sounds/')) {
    return {
      'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
    }
  }

  // Evaluacion por tipo de archivo y fecha de modificacion
  if (stat && ext) {
    const mediaExtensions = ['.mp4', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg', '.mp3', '.wav', '.ogg']
    const fontExtensions = ['.woff', '.woff2', '.ttf', '.otf', '.eot']

    if (mediaExtensions.includes(ext) || fontExtensions.includes(ext)) {
      const ageInMs = Date.now() - stat.mtimeMs
      const ageInWeeks = ageInMs / (1000 * 60 * 60 * 24 * 7)

      // Si el archivo tiene mas de 1 semana sin modificarse, lo cacheamos agresivamente.
      // Si es reciente, usamos no-cache para asegurar que los cambios se reflejen de inmediato.
      if (ageInWeeks > 1) {
        return {
          'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000'
        }
      } else {
        return {
          'Cache-Control': 'no-cache'
        }
      }
    }
  }

  return {
    'Cache-Control': 'no-cache',
  }
}
