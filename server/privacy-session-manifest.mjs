import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MANIFEST_SCHEMA_VERSION = 1
const DEFAULT_NOTICE_VERSION = 'broadcast-notice-v1'
const safeTokenPattern = /^[a-z0-9][a-z0-9._-]{0,39}$/i

const normalizePolicyPath = (value) => {
  const candidate = String(value || '/legal/privacy.md').trim()
  if (!candidate.startsWith('/legal/') || candidate.includes('..') || candidate.includes('\\')) {
    return '/legal/privacy.md'
  }
  return /\.md$/i.test(candidate) ? candidate : '/legal/privacy.md'
}

const normalizeChannels = (value) => Array.from(new Set(
  String(value || '')
    .split(',')
    .map((channel) => channel.trim().toLowerCase())
    .filter((channel) => safeTokenPattern.test(channel)),
)).slice(0, 10)

const extractVersion = (text) => {
  const match = text.match(/^Versi[oó]n:\s*(.+?)\s*$/im)
  return match?.[1]?.trim() || 'sin-version-declarada'
}

const resolveInside = (root, relativePath) => {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, relativePath)
  const prefix = `${resolvedRoot}${path.sep}`
  if (target !== resolvedRoot && !target.startsWith(prefix)) return null
  return target
}

const loadPolicyEvidence = async (publicDir, configuredPath) => {
  const policyPath = normalizePolicyPath(configuredPath)
  const relativePath = policyPath.replace(/^\/+/, '').split('/').join(path.sep)
  const target = resolveInside(publicDir, relativePath)
  if (!target) return { path: policyPath, version: 'no-disponible', sha256: null }

  try {
    const text = await readFile(target, 'utf8')
    return {
      path: policyPath,
      version: extractVersion(text),
      sha256: createHash('sha256').update(text).digest('hex'),
    }
  } catch {
    return { path: policyPath, version: 'no-disponible', sha256: null }
  }
}

const toIso = (value) => new Date(value).toISOString()
const fileSafeIso = (value) => toIso(value).replace(/[:.]/g, '-')

export const createPrivacySessionManifestRecorder = ({
  manifestDir = process.env.SEFER_PRIVACY_MANIFEST_DIR,
  publicDir = path.resolve('public'),
  policyPath = '/legal/privacy.md',
  policyEvidence,
  channels = process.env.SEFER_EXTERNAL_BROADCAST_CHANNELS,
  softwareVersion = process.env.SEFER_DEPLOYMENT_VERSION || 'unversioned',
  noticeVersion = process.env.SEFER_BROADCAST_NOTICE_VERSION || DEFAULT_NOTICE_VERSION,
  now = () => Date.now(),
  createId = randomUUID,
  onError = () => console.error('Privacy session manifest write failed'),
} = {}) => {
  const resolvedManifestDir = manifestDir ? path.resolve(manifestDir) : null
  const normalizedChannels = normalizeChannels(channels)
  const normalizedNoticeVersion = safeTokenPattern.test(String(noticeVersion))
    ? String(noticeVersion)
    : DEFAULT_NOTICE_VERSION
  const normalizedSoftwareVersion = safeTokenPattern.test(String(softwareVersion))
    ? String(softwareVersion)
    : 'unversioned'
  let active = null
  let queue = Promise.resolve()

  const persist = async (manifest) => {
    if (!resolvedManifestDir) return
    await mkdir(resolvedManifestDir, { recursive: true })
    const target = path.join(resolvedManifestDir, manifest.fileName)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(manifest.document, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporary, target)
  }

  const start = async (timestamp, nextState) => {
    if (!resolvedManifestDir || active) return
    const manifestId = createId()
    const policy = policyEvidence || await loadPolicyEvidence(publicDir, policyPath)
    const document = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      manifestId,
      status: nextState,
      startedAt: toIso(timestamp),
      endedAt: null,
      channels: normalizedChannels,
      softwareVersion: normalizedSoftwareVersion,
      noticeVersion: normalizedNoticeVersion,
      policy,
      checks: {
        broadcastStateDeclared: true,
        channelsConfigured: normalizedChannels.length > 0,
        softwareVersionConfigured: normalizedSoftwareVersion !== 'unversioned',
        policyResolved: Boolean(policy.sha256),
      },
      containsPersonalData: false,
      outcome: null,
    }
    active = {
      fileName: `${fileSafeIso(timestamp)}-${manifestId}.local.json`,
      document,
    }
    await persist(active)
  }

  const finish = async (timestamp, nextState) => {
    if (!active) return
    active.document = {
      ...active.document,
      status: 'completed',
      endedAt: toIso(timestamp),
      outcome: nextState === 'off' ? 'broadcast-stopped' : `transitioned-to-${nextState}`,
    }
    await persist(active)
    active = null
  }

  const applyTransition = async ({ nextState, updatedAt } = {}) => {
    if (!resolvedManifestDir || !['off', 'live', 'recording'].includes(nextState)) return
    const timestamp = Number.isFinite(updatedAt) ? updatedAt : now()
    
    if (active && nextState !== 'recording') {
      await finish(timestamp, nextState)
    }

    if (nextState === 'recording' && !active) {
      await start(timestamp, nextState)
    }
  }

  const recordTransition = (transition) => {
    queue = queue
      .then(() => applyTransition(transition))
      .catch(() => onError())
    return queue
  }

  return {
    enabled: Boolean(resolvedManifestDir),
    recordTransition,
    flush: () => queue,
  }
}

export { normalizeChannels, normalizePolicyPath }
