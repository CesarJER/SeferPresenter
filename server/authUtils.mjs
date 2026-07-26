export const isAuthRequired = () => process.env.SEFER_REQUIRE_AUTH === 'true'

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
