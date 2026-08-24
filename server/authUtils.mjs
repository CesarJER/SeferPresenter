// Secure by default. Development tooling opts out explicitly when requested.
export const isAuthRequired = () => process.env.SEFER_REQUIRE_AUTH !== 'false'

const publicApiGetPaths = new Set([
  '/api/audience/state',
  '/api/audience/events',
  '/api/quiz-events',
  '/api/public-catalogs',
  '/api/audience-cache-assets',
  '/api/branding/logo.svg',
  '/api/branding/favicon.svg',
  '/api/branding/welcome.md',
])

const firstHeaderValue = (value) => {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' ? raw.split(',')[0].trim() : ''
}

const normalizeOrigin = (value) => {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin.toLowerCase()
  } catch {
    return null
  }
}

export const isPublicApiRequest = (pathname, method = 'GET') => {
  if (pathname.startsWith('/api/livekit/')) return true
  if (method === 'POST' && (pathname === '/api/audience/access/bootstrap' || pathname === '/api/audience/sse-ticket')) return true
  if (method === 'POST' && pathname === '/api/quiz-answer') return true
  if (method !== 'GET') return false
  if (publicApiGetPaths.has(pathname)) return true
  return /^\/api\/public-catalogs\/[^/]+\/presentations(?:\/[^/]+)?$/.test(pathname)
}

export const isProtectedRequestPath = (pathname, method = 'GET') => {
  if (!isAuthRequired()) return false
  if (pathname.startsWith('/audience') || pathname === '/proteccion-datos' || pathname === '/') return false
  if (pathname.startsWith('/api/')) return !isPublicApiRequest(pathname, method)
  return pathname === '/control' || pathname === '/audio-editor' || pathname === '/presenter'
}

export const hasAllowedRequestOrigin = (req) => {
  const originHeader = firstHeaderValue(req.headers.origin)
  if (!originHeader) return true

  const requestOrigin = normalizeOrigin(originHeader)
  if (!requestOrigin) return false

  const configuredOrigins = String(process.env.SEFER_ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean)
  if (configuredOrigins.length > 0) return configuredOrigins.includes(requestOrigin)

  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host)
  if (!host) return false
  const forwardedProtocol = firstHeaderValue(req.headers['x-forwarded-proto'])
  const protocol = forwardedProtocol || (req.socket?.encrypted ? 'https' : 'http')
  return normalizeOrigin(`${protocol}://${host}`) === requestOrigin
}

export const hasValidBasicAuth = (req) => {
  const expectedPassword = process.env.SEFER_CONTROL_PASSWORD
  if (!expectedPassword) return false
  const header = req.headers.authorization || ''
  if (!header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf-8')
  const separatorIndex = decoded.indexOf(':')
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded
  return password === expectedPassword
}
