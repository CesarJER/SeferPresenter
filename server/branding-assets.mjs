import fs from 'node:fs'
import crypto from 'node:crypto'

const readFileIfPresent = (filePath) => {
  try {
    return fs.readFileSync(filePath)
  } catch {
    return null
  }
}

export const makeBrandingEtag = (body) => (
  `"${crypto.createHash('sha256').update(body).digest('base64url')}"`
)

export const loadBrandingAsset = ({ overridePath, fallbackPath }) => {
  const body = readFileIfPresent(overridePath) ?? readFileIfPresent(fallbackPath)
  if (body === null) {
    throw new Error(`Branding fallback is missing or invalid: ${fallbackPath}`)
  }
  return { body, etag: makeBrandingEtag(body) }
}
