import fs from 'node:fs'
import path from 'node:path'

const booleanValues = new Map([['true', true], ['false', false]])
const recordingStates = new Set(['NOT_RECORDING', 'RECORDING'])
const accessModes = new Set(['PUBLIC', 'CONTROLLED'])

const requiredText = (env, name, errors) => {
  const value = String(env[name] || '').trim()
  if (!value) errors.push(`${name} is required`)
  return value
}

const parseBoolean = (env, name, errors) => {
  const raw = String(env[name] || '').trim().toLowerCase()
  if (!booleanValues.has(raw)) {
    errors.push(`${name} must be true or false`)
    return false
  }
  return booleanValues.get(raw)
}

const isSafePublicUrl = (value) => {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export const buildOperatorManifest = (env) => {
  const errors = []
  const operatorName = requiredText(env, 'VITE_ORGANIZATION_NAME', errors)
  const rightsContact = requiredText(env, 'VITE_ORGANIZATION_EMAIL', errors)
  const legalBasis = requiredText(env, 'VITE_SEFER_LEGAL_BASIS', errors)
  const privacyUrl = requiredText(env, 'VITE_SEFER_PRIVACY_URL', errors)
  const recordingAvailable = parseBoolean(env, 'VITE_SEFER_RECORDING_AVAILABLE', errors)
  const recordingMutable = parseBoolean(env, 'VITE_SEFER_RECORDING_MUTABLE', errors)
  const recordingDefault = requiredText(env, 'VITE_SEFER_RECORDING_DEFAULT', errors).toUpperCase()
  const accessDefault = requiredText(env, 'VITE_SEFER_SESSION_ACCESS_DEFAULT', errors).toUpperCase()

  if (rightsContact && !rightsContact.includes('@') && !isSafePublicUrl(rightsContact)) {
    errors.push('VITE_ORGANIZATION_EMAIL must be an email address or public contact URL')
  }
  if (privacyUrl && !isSafePublicUrl(privacyUrl)) {
    errors.push('VITE_SEFER_PRIVACY_URL must be a relative path or HTTP(S) URL')
  }
  if (recordingDefault && !recordingStates.has(recordingDefault)) {
    errors.push('VITE_SEFER_RECORDING_DEFAULT must be NOT_RECORDING or RECORDING')
  }
  if (!recordingAvailable && recordingDefault === 'RECORDING') {
    errors.push('VITE_SEFER_RECORDING_DEFAULT cannot be RECORDING when recording is unavailable')
  }
  if (accessDefault && !accessModes.has(accessDefault)) {
    errors.push('VITE_SEFER_SESSION_ACCESS_DEFAULT must be PUBLIC or CONTROLLED')
  }
  if (errors.length > 0) {
    throw new Error(`Invalid operator configuration:\n- ${errors.join('\n- ')}`)
  }

  return {
    schemaVersion: 1,
    operatorName,
    legalId: String(env.VITE_ORGANIZATION_LEGAL_ID || '').trim(),
    rightsContact,
    website: String(env.VITE_ORGANIZATION_WEBSITE || '').trim(),
    legalBasis,
    privacyUrl,
    recordingAvailable,
    recordingDefault,
    recordingMutable,
    accessDefault,
  }
}

export const validateOperatorManifestFile = (staticDir, runtimeEnv = process.env) => {
  const filePath = path.join(staticDir, 'operator-manifest.json')
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required operator manifest is missing: ${filePath}`)
  }
  const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  const rebuilt = buildOperatorManifest({
    VITE_ORGANIZATION_NAME: manifest.operatorName,
    VITE_ORGANIZATION_LEGAL_ID: manifest.legalId,
    VITE_ORGANIZATION_EMAIL: manifest.rightsContact,
    VITE_ORGANIZATION_WEBSITE: manifest.website,
    VITE_SEFER_LEGAL_BASIS: manifest.legalBasis,
    VITE_SEFER_PRIVACY_URL: manifest.privacyUrl,
    VITE_SEFER_RECORDING_AVAILABLE: String(manifest.recordingAvailable),
    VITE_SEFER_RECORDING_DEFAULT: manifest.recordingDefault,
    VITE_SEFER_RECORDING_MUTABLE: String(manifest.recordingMutable),
    VITE_SEFER_SESSION_ACCESS_DEFAULT: manifest.accessDefault,
  })
  const runtimeAccess = String(runtimeEnv.SEFER_SESSION_ACCESS_DEFAULT || 'PUBLIC').toUpperCase()
  if (rebuilt.accessDefault !== runtimeAccess) {
    throw new Error(
      `Operator manifest accessDefault (${rebuilt.accessDefault}) does not match SEFER_SESSION_ACCESS_DEFAULT (${runtimeAccess})`,
    )
  }
  return rebuilt
}

export const readPrivacyLocalMarkdown = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null
  const stat = fs.statSync(filePath)
  if (!stat.isFile()) throw new Error(`privacy.local.md path is not a file: ${filePath}`)
  if (stat.size === 0 || stat.size > 128 * 1024) {
    throw new Error('privacy.local.md must contain between 1 byte and 128 KiB')
  }
  let markdown
  try {
    markdown = new TextDecoder('utf-8', { fatal: true })
      .decode(fs.readFileSync(filePath))
      .replace(/^\uFEFF/, '')
  } catch {
    throw new Error('privacy.local.md must be valid UTF-8')
  }
  if (markdown.includes('\0')) throw new Error('privacy.local.md contains NUL bytes')
  return markdown
}
