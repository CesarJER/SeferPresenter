import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { appendFile, mkdir, readFile, readdir, rename, stat, truncate, unlink, writeFile } from 'node:fs/promises'
import { createServer, isIP } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const RESTART_COOLDOWN_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 60 * 1000
const MAX_LOG_BYTES = 64 * 1024
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const PUBLIC_IP_ENDPOINTS = ['https://api.ipify.org', 'https://icanhazip.com']
const DNS_SERVERS = ['1.1.1.1', '8.8.8.8']
const EVENTS = new Set([
  'SKIP_STOPPED', 'SKIP_CONFIGURATION', 'WAIT_INTERNET', 'WAIT_DDNS', 'WAIT_DNS',
  'WAIT_HEALTH', 'WAIT_RUNTIME_IP', 'WAIT_STABILITY', 'WAIT_COOLDOWN', 'WAIT_RECOVERY',
  'HEALTHY', 'NETWORK_READY', 'IP_CHANGED', 'SERVICE_UNHEALTHY', 'DRY_RUN_RESTART', 'RESTARTED',
  'RESTART_FAILED', 'DOCKER_UNAVAILABLE', 'MONITOR_ERROR', 'CONFIGURATION_ERROR',
  'ALREADY_RUNNING',
])

export function isPublicIpv4(value) {
  if (typeof value !== 'string' || isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
    !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127)
}

export function publicLivekitHost(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (!['wss:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    if (!host.includes('.') || host.includes(':') || /\.(?:localhost|local|internal)$/.test(host)) return null
    if (isIP(host) && !isPublicIpv4(host)) return null
    return host
  } catch { return null }
}

export function initialRecoveryState(saved = {}) {
  return {
    candidate: null,
    samples: 0,
    unhealthySamples: 0,
    lastRestartAt: Number.isFinite(saved.lastRestartAt) && saved.lastRestartAt >= 0 ? saved.lastRestartAt : 0,
    attempted: typeof saved.attempted === 'string' && /^[a-f0-9]{64}$/.test(saved.attempted) ? saved.attempted : null,
  }
}

// This decision has no I/O. Two consecutive ready samples are required;
// failed/uncertain observations break the sequence. One attempt per incident
// remains latched until health and the advertised IP recover.
export function decideRecovery(state, sample, now = Date.now()) {
  let next = { ...state }
  const wait = (event, reset = true) => {
    if (reset) next = { ...next, candidate: null, samples: 0, unhealthySamples: 0 }
    return { action: 'none', event, state: next }
  }
  if (sample.status !== 'running') return wait('SKIP_STOPPED')
  if (!sample.publicMode || !sample.autoDetect || sample.fixedNodeIp) return wait('SKIP_CONFIGURATION')
  if (!isPublicIpv4(sample.publicIp)) return wait('WAIT_INTERNET')
  if (sample.confirmedIp !== sample.publicIp) return wait('WAIT_DDNS')
  if (!Array.isArray(sample.dnsAnswers) || sample.dnsAnswers.length !== 2 ||
      sample.dnsAnswers.some((answers) => !Array.isArray(answers) || answers.length === 0 ||
        answers.some((ip) => ip !== sample.publicIp))) return wait('WAIT_DNS')
  if (sample.health === 'starting') return wait('WAIT_HEALTH')
  if (isIP(sample.runtimeIp || '') !== 4 && sample.health !== 'unhealthy') return wait('WAIT_RUNTIME_IP')

  const candidate = createHash('sha256').update(`${sample.containerId}|${sample.publicIp}`).digest('hex')
  next.samples = state.candidate === candidate ? Math.min(2, state.samples + 1) : 1
  next.unhealthySamples = sample.health === 'unhealthy'
    ? (state.candidate === candidate ? Math.min(2, state.unhealthySamples + 1) : 1) : 0
  next.candidate = candidate
  const ipChanged = sample.runtimeIp !== sample.publicIp
  if (!ipChanged && sample.health !== 'unhealthy') {
    if (sample.health === 'healthy') next.attempted = null
    return wait(sample.health === 'healthy' ? 'HEALTHY' : 'NETWORK_READY', false)
  }
  if (next.samples < 2 || (sample.health === 'unhealthy' && next.unhealthySamples < 2)) return wait('WAIT_STABILITY', false)
  if (state.attempted === candidate) return wait('WAIT_RECOVERY', false)
  if (state.lastRestartAt && now - state.lastRestartAt < RESTART_COOLDOWN_MS) return wait('WAIT_COOLDOWN', false)
  next.lastRestartAt = now
  next.attempted = candidate
  return { action: 'restart', event: ipChanged ? 'IP_CHANGED' : 'SERVICE_UNHEALTHY', state: next }
}

export function serializeMonitorEvent(event, now = Date.now()) {
  if (!EVENTS.has(event)) throw new Error('Unknown monitor event')
  // No raw errors, addresses, container IDs, endpoints, or peer identities.
  return `${JSON.stringify({ at: new Date(now).toISOString(), event })}\n`
}

async function docker(args, timeout = 15000) {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'docker.exe' : 'docker', args, {
      cwd: repositoryRoot, windowsHide: true, timeout, maxBuffer: 8192,
    })
    return stdout.trim()
  } catch { throw new Error('DOCKER_UNAVAILABLE') }
}

async function readContainer() {
  const ids = (await docker(['compose', '--project-directory', repositoryRoot, '-f',
    path.join(repositoryRoot, 'docker-compose.yml'), 'ps', '--all', '--quiet', 'livekit']))
    .split(/\s+/).filter((id) => /^[a-f0-9]{12,64}$/.test(id))
  if (ids.length === 0) return { status: 'absent' }
  if (ids.length !== 1) throw new Error('Ambiguous LiveKit container')
  const containerId = ids[0]
  const [status, health] = (await docker(['inspect', '--format',
    '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', containerId])).split('|')
  if (status !== 'running') return { containerId, status, health }
  // Select just these network values. Never print/dump /proc/1/environ.
  const output = await docker(['exec', containerId, '/bin/sh', '-ec',
    'printf "AUTO=%s\\nFIXED=%s\\n" "$LIVEKIT_NODE_IP_AUTO_DETECT" "$LIVEKIT_NODE_IP"; tr "\\000" "\\n" < /proc/1/environ | grep "^NODE_IP=" || true'])
  const fields = Object.fromEntries(output.split('\n').map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1).trim()]
  }))
  return { containerId, status, health, autoDetect: fields.AUTO === 'true', fixedNodeIp: fields.FIXED || '', runtimeIp: fields.NODE_IP || null }
}

async function readPublicIp() {
  const responses = await Promise.allSettled(PUBLIC_IP_ENDPOINTS.map(async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })
    if (!response.ok) return null
    const value = (await response.text()).trim()
    return isPublicIpv4(value) ? value : null
  }))
  const values = responses.filter((result) => result.status === 'fulfilled' && result.value).map((result) => result.value)
  return values.length && values.every((value) => value === values[0]) ? values[0] : null
}

async function readDns(host) {
  return Promise.all(DNS_SERVERS.map(async (server) => {
    const resolver = new Resolver({ timeout: 3000, tries: 1 })
    resolver.setServers([server])
    try { return await resolver.resolve4(host) } catch { return [] }
  }))
}

async function readConfirmedIp(file) {
  try {
    const value = (await readFile(file, 'utf8')).trim()
    return isPublicIpv4(value) ? value : null
  } catch { return null }
}

async function observe(config) {
  const container = await readContainer()
  const publicMode = Boolean(config.host && process.env.LIVEKIT_NODE_IP_AUTO_DETECT === 'true' &&
    !(process.env.LIVEKIT_NODE_IP || '').trim())
  if (container.status !== 'running' || !publicMode || !container.autoDetect || container.fixedNodeIp) {
    return { ...container, publicMode }
  }
  const [publicIp, confirmedIp, dnsAnswers] = await Promise.all([
    readPublicIp(), readConfirmedIp(config.ddnsStateFile), readDns(config.host),
  ])
  return { ...container, publicMode, publicIp, confirmedIp, dnsAnswers }
}

async function saveRecoveryState(file, state) {
  // No addresses are persisted here; a digest latches each recovery incident.
  const temporary = `${file}.tmp`
  await writeFile(temporary, JSON.stringify({ lastRestartAt: state.lastRestartAt, attempted: state.attempted }), { mode: 0o600 })
  await rename(temporary, file)
}

export async function writePrivateMonitorEvent(stateDir, event, now = Date.now()) {
  const line = serializeMonitorEvent(event, now)
  const file = path.join(stateDir, `events-${new Date(now).toISOString().slice(0, 10)}.jsonl`)
  for (const name of await readdir(stateDir)) {
    const match = /^events-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name)
    if (match && Date.parse(`${match[1]}T00:00:00Z`) <= now - LOG_RETENTION_MS) await unlink(path.join(stateDir, name))
  }
  try { if ((await stat(file)).size + Buffer.byteLength(line) > MAX_LOG_BYTES) await truncate(file, 0) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await appendFile(file, line, { mode: 0o600 })
}

async function logEvent(config, event) {
  process.stdout.write(serializeMonitorEvent(event))
  if (!config.check) await writePrivateMonitorEvent(config.stateDir, event)
}

// An exclusive loopback socket is released by the OS when the process dies.
// It is only a lock: no HTTP, protocol, data, or public listener.
export async function acquireMonitorGuard(port = 48389) {
  const server = createServer((socket) => socket.destroy())
  return new Promise((resolve, reject) => {
    server.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(null) : reject(error))
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(server))
  })
}

export function monitorConfiguration(args, env = process.env, root = repositoryRoot) {
  const config = { once: false, dryRun: false, check: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--once') config.once = true
    else if (args[i] === '--dry-run') config.dryRun = true
    else if (args[i] === '--check') Object.assign(config, { once: true, dryRun: true, check: true })
    else if (args[i] === '--ddns-state-file' || args[i] === '--state-dir') {
      const key = args[i] === '--state-dir' ? 'stateDir' : 'ddnsStateFile'
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing file argument')
      config[key] = path.resolve(root, args[++i])
    } else throw new Error('Unknown argument')
  }
  const dataRoot = env.SEFER_DATA_DIR && path.resolve(root, env.SEFER_DATA_DIR)
  if (!config.ddnsStateFile && !dataRoot) throw new Error('Private DDNS state file is required')
  config.ddnsStateFile ||= path.join(dataRoot, 'tmp', 'hostinger-ddns', 'last-confirmed-ip')
  config.stateDir ||= path.join(dataRoot || path.dirname(config.ddnsStateFile), 'tmp', 'livekit-network-monitor')
  config.host = publicLivekitHost(env.LIVEKIT_URL)
  return config
}

export async function runMonitor(args = process.argv.slice(2)) {
  try { process.loadEnvFile(path.join(repositoryRoot, '.env')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const config = monitorConfiguration(args)
  const stateFile = path.join(config.stateDir, 'recovery-state.json')
  let guard = null
  if (!config.check) {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 })
    guard = await acquireMonitorGuard()
    if (!guard) { await logEvent(config, 'ALREADY_RUNNING'); return }
  }
  let state = initialRecoveryState()
  try { state = initialRecoveryState(JSON.parse(await readFile(stateFile, 'utf8'))) } catch { /* First run has no state. */ }
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    do {
      try {
        const sample = await observe(config)
        if (controller.signal.aborted) break
        const previousState = state
        const decision = decideRecovery(state, sample)
        state = decision.state
        await logEvent(config, decision.event)
        if (decision.action === 'restart') {
          if (config.dryRun) {
            state.lastRestartAt = previousState.lastRestartAt
            state.attempted = previousState.attempted
            await logEvent(config, 'DRY_RUN_RESTART')
          } else {
            // Persist cooldown/latch BEFORE attempting the exact container ID.
            // Never restart the stack or revive a stopped/manual/LAN service.
            const current = await readContainer()
            if (!controller.signal.aborted && current.containerId === sample.containerId && current.status === 'running' &&
                current.health !== 'starting' && current.autoDetect && !current.fixedNodeIp &&
                (current.runtimeIp !== sample.publicIp || current.health === 'unhealthy')) {
              await saveRecoveryState(stateFile, state)
              try {
                await docker(['restart', '--timeout', '10', sample.containerId], 45000)
                await logEvent(config, 'RESTARTED')
              } catch { await logEvent(config, 'RESTART_FAILED') }
            }
          }
        } else if (!config.check && !config.dryRun) {
          await saveRecoveryState(stateFile, state)
        }
      } catch (error) {
        state = { ...state, candidate: null, samples: 0, unhealthySamples: 0 }
        await logEvent(config, error.message === 'DOCKER_UNAVAILABLE' ? 'DOCKER_UNAVAILABLE' : 'MONITOR_ERROR')
      }
      if (!config.once) await delay(POLL_INTERVAL_MS, null, { signal: controller.signal }).catch(() => {})
    } while (!config.once && !controller.signal.aborted)
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    if (guard) await new Promise((resolve) => guard.close(resolve))
  }
}

if (process.argv[1] && path.relative(path.resolve(process.argv[1]), fileURLToPath(import.meta.url)) === '') {
  runMonitor().catch(() => {
    process.stderr.write(serializeMonitorEvent('CONFIGURATION_ERROR'))
    process.exitCode = 1
  })
}
