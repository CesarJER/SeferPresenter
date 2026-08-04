export const getStaticCacheHeaders = (requestPath = '') => {
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
  return {}
}
