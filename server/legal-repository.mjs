import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { writeJsonSafely } from './json-persistence.mjs'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const hash = (contents) => createHash('sha256').update(contents).digest('hex')

const readJson = (filePath, label) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`)
  }
}

const assertRealFile = (filePath, label) => {
  const stats = fs.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`${label} must be a real file`)
}

const assertRealDirectory = (directoryPath, label) => {
  const stats = fs.lstatSync(directoryPath)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error(`${label} must be a real directory`)
}

const validateDocument = (releaseDir, name, descriptor) => {
  if (
    !descriptor
    || typeof descriptor.file !== 'string'
    || path.basename(descriptor.file) !== descriptor.file
    || !descriptor.file.toLowerCase().endsWith('.md')
    || !SHA256_PATTERN.test(descriptor.sha256)
  ) {
    throw new Error(`Legal document descriptor is invalid: ${name}`)
  }
  const filePath = path.join(releaseDir, descriptor.file)
  assertRealFile(filePath, `Legal document ${name}`)
  if (hash(fs.readFileSync(filePath)) !== descriptor.sha256) {
    throw new Error(`Legal document hash mismatch: ${name}`)
  }
  return filePath
}

export const loadLegalRepository = ({ dataDir, now = () => new Date().toISOString() } = {}) => {
  if (!dataDir) throw new Error('dataDir is required')
  const legalDir = path.join(dataDir, 'legal')
  const currentPath = path.join(legalDir, 'current.json')
  if (!fs.existsSync(currentPath)) return Object.freeze({ status: 'LEGAL_NOT_CONFIGURED' })

  assertRealDirectory(legalDir, 'Legal repository')
  assertRealFile(currentPath, 'Legal current.json')
  const current = readJson(currentPath, 'Legal current.json')
  if (
    current?.schemaVersion !== 1
    || !Number.isSafeInteger(current.sequence)
    || current.sequence < 1
    || !SHA256_PATTERN.test(current.manifestSha256)
  ) {
    throw new Error('Legal current.json has an invalid schema')
  }

  let previousManifestSha256 = null
  let activeRelease = null
  const manifestHashes = new Map()
  for (let sequence = 1; sequence <= current.sequence; sequence += 1) {
    const releaseDir = path.join(legalDir, 'releases', String(sequence).padStart(6, '0'))
    const manifestPath = path.join(releaseDir, 'manifest.json')
    assertRealDirectory(releaseDir, `Legal release ${sequence}`)
    assertRealFile(manifestPath, `Legal manifest ${sequence}`)
    const manifestContents = fs.readFileSync(manifestPath)
    const manifestSha256 = hash(manifestContents)
    const manifest = readJson(manifestPath, `Legal manifest ${sequence}`)
    if (
      manifest?.schemaVersion !== 1
      || manifest.sequence !== sequence
      || manifest.previousManifestSha256 !== previousManifestSha256
      || typeof manifest.version !== 'string'
      || !manifest.version.trim()
      || typeof manifest.status !== 'string'
      || !manifest.status.trim()
      || !(manifest.effectiveDate === null || (
        typeof manifest.effectiveDate === 'string'
        && Number.isFinite(Date.parse(manifest.effectiveDate))
      ))
      || !manifest.documents
    ) {
      throw new Error(`Legal manifest chain is invalid at sequence ${sequence}`)
    }

    const documents = Object.fromEntries(
      Object.entries(manifest.documents).map(([name, descriptor]) => [
        name,
        validateDocument(releaseDir, name, descriptor),
      ]),
    )
    if (!documents.privacyPolicy || !documents.privacySummary) {
      throw new Error(`Legal release ${sequence} is missing required documents`)
    }

    previousManifestSha256 = manifestSha256
    manifestHashes.set(sequence, manifestSha256)
    activeRelease = { manifest, manifestSha256, documents }
  }

  if (activeRelease.manifestSha256 !== current.manifestSha256) {
    throw new Error('Legal current.json does not match the active manifest')
  }

  const anchorPath = path.join(dataDir, 'config', 'legal-activation.json')
  let anchor = null
  if (fs.existsSync(anchorPath)) {
    anchor = readJson(anchorPath, 'Legal activation anchor')
    if (
      anchor.schemaVersion !== 1
      || !Number.isSafeInteger(anchor.maxSequence)
      || !SHA256_PATTERN.test(anchor.manifestSha256)
      || anchor.manifestSha256 !== manifestHashes.get(anchor.maxSequence)
      || anchor.maxSequence > current.sequence
      || (anchor.maxSequence === current.sequence && anchor.manifestSha256 !== current.manifestSha256)
    ) {
      throw new Error('LEGAL_ROLLBACK_DETECTED')
    }
  }

  fs.mkdirSync(path.dirname(anchorPath), { recursive: true })
  if (!anchor || anchor.maxSequence < current.sequence) {
    writeJsonSafely(anchorPath, {
      schemaVersion: 1,
      maxSequence: current.sequence,
      manifestSha256: current.manifestSha256,
      activatedAt: now(),
    })
  }

  const { manifest, manifestSha256, documents } = activeRelease
  return Object.freeze({
    status: 'ACTIVE',
    documents: Object.freeze(documents),
    policyEvidence: Object.freeze({
      path: '/legal/privacy.md',
      version: manifest.version,
      sha256: manifest.documents.privacyPolicy.sha256,
    }),
    publicManifest: Object.freeze({
      schemaVersion: manifest.schemaVersion,
      sequence: manifest.sequence,
      version: manifest.version,
      status: manifest.status,
      effectiveDate: manifest.effectiveDate,
      manifestSha256,
      previousManifestSha256: manifest.previousManifestSha256,
      documents: Object.freeze({
        privacyPolicy: manifest.documents.privacyPolicy,
        privacySummary: manifest.documents.privacySummary,
      }),
    }),
  })
}
