import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  decideRecovery, initialRecoveryState, publicLivekitHost,
  RESTART_COOLDOWN_MS, serializeMonitorEvent, acquireMonitorGuard,
  monitorConfiguration, writePrivateMonitorEvent,
} from '../scripts/watch-livekit-network.mjs'

const ip = '8.4.3.2'
const ready = {
  containerId: 'a'.repeat(64), status: 'running', health: 'healthy',
  publicMode: true, autoDetect: true, fixedNodeIp: '', runtimeIp: '8.4.3.1',
  publicIp: ip, confirmedIp: ip, dnsAnswers: [[ip], [ip]],
}
const now = 10 * RESTART_COOLDOWN_MS

describe('host LiveKit network recovery', () => {
  it('requires two stable samples before restarting the exact LiveKit container', () => {
    const first = decideRecovery(initialRecoveryState(), ready, now)
    expect(first.action).toBe('none')
    expect(first.event).toBe('WAIT_STABILITY')
    const second = decideRecovery(first.state, ready, now + 60_000)
    expect(second.action).toBe('restart')
    expect(second.event).toBe('IP_CHANGED')
    expect(second.state.lastRestartAt).toBe(now + 60_000)
  })

  it.each([
    [{ confirmedIp: '8.4.3.1' }, 'WAIT_DDNS'],
    [{ dnsAnswers: [[ip], ['8.4.3.1']] }, 'WAIT_DNS'],
    [{ dnsAnswers: [[ip], []] }, 'WAIT_DNS'],
    [{ publicIp: null }, 'WAIT_INTERNET'],
    [{ status: 'exited' }, 'SKIP_STOPPED'],
    [{ publicMode: false }, 'SKIP_CONFIGURATION'],
    [{ autoDetect: false }, 'SKIP_CONFIGURATION'],
    [{ fixedNodeIp: '192.168.1.5' }, 'SKIP_CONFIGURATION'],
    [{ health: 'starting' }, 'WAIT_HEALTH'],
  ])('does not restart while a safety prerequisite fails (%j)', (changes, event) => {
    const first = decideRecovery(initialRecoveryState(), ready, now)
    const decision = decideRecovery(first.state, { ...ready, ...changes }, now + 60_000)
    expect(decision.action).toBe('none')
    expect(decision.event).toBe(event)
    expect(decision.state.samples).toBe(0)
  })

  it('resets stability after an address changes or the Internet/DNS observation fails', () => {
    const first = decideRecovery(initialRecoveryState(), ready, now)
    const changedIp = '8.4.3.3'
    const changed = decideRecovery(first.state, {
      ...ready, publicIp: changedIp, confirmedIp: changedIp, dnsAnswers: [[changedIp], [changedIp]],
    }, now + 60_000)
    expect(changed.action).toBe('none')
    expect(changed.state.samples).toBe(1)
    const failure = decideRecovery(changed.state, { ...ready, publicIp: null }, now + 120_000)
    expect(decideRecovery(failure.state, ready, now + 180_000).action).toBe('none')
  })

  it('requires two unhealthy samples and does not create a restart loop', () => {
    const sample = { ...ready, runtimeIp: ip, health: 'unhealthy' }
    const first = decideRecovery(initialRecoveryState(), sample, now)
    const second = decideRecovery(first.state, sample, now + 60_000)
    expect(first.action).toBe('none')
    expect(second.action).toBe('restart')
    expect(second.event).toBe('SERVICE_UNHEALTHY')
    const later = decideRecovery(second.state, sample, now + 2 * RESTART_COOLDOWN_MS)
    expect(later.action).toBe('none')
    expect(later.event).toBe('WAIT_RECOVERY')
    const healthy = decideRecovery(later.state, { ...sample, health: 'healthy' }, now + 3 * RESTART_COOLDOWN_MS)
    const nextFault = decideRecovery(healthy.state, sample, now + 4 * RESTART_COOLDOWN_MS)
    expect(nextFault.action).toBe('none')
    expect(decideRecovery(nextFault.state, sample, now + 4 * RESTART_COOLDOWN_MS + 60_000).action).toBe('restart')
  })

  it('respects the five-minute cooldown even across process restarts', () => {
    const saved = initialRecoveryState({ lastRestartAt: now - 60_000 })
    const first = decideRecovery(saved, ready, now)
    const second = decideRecovery(first.state, ready, now + 60_000)
    expect(second.action).toBe('none')
    expect(second.event).toBe('WAIT_COOLDOWN')
    expect(decideRecovery(second.state, ready, now + RESTART_COOLDOWN_MS).action).toBe('restart')
  })

  it('restarts neither healthy current-IP containers nor LAN/static configurations', () => {
    expect(decideRecovery(initialRecoveryState(), { ...ready, runtimeIp: ip }, now).event).toBe('HEALTHY')
    expect(decideRecovery(initialRecoveryState(), { ...ready, runtimeIp: ip, health: 'none' }, now).event).toBe('NETWORK_READY')
    expect(publicLivekitHost('wss://example.org/livekit')).toBe('example.org')
    for (const url of ['ws://example.org', 'wss://localhost', 'wss://192.168.1.2', 'wss://server.local', 'wss://100.64.0.1']) {
      expect(publicLivekitHost(url)).toBeNull()
    }
  })

  it('logs only a timestamp and an allowlisted enum, never addresses or raw errors', () => {
    expect(JSON.parse(serializeMonitorEvent('WAIT_DNS', now))).toEqual({
      at: new Date(now).toISOString(), event: 'WAIT_DNS',
    })
    expect(() => serializeMonitorEvent(`connection failed at ${ip}`, now)).toThrow()
    const saved = decideRecovery(decideRecovery(initialRecoveryState(), ready, now).state, ready, now + 60_000).state
    expect(JSON.stringify(saved)).not.toContain(ip)
  })

  it('requires private state configuration and makes --check read-only', () => {
    const env = { SEFER_DATA_DIR: '../private-data', LIVEKIT_URL: 'wss://example.org' }
    const root = path.resolve(tmpdir(), 'sefer-test-repository')
    const config = monitorConfiguration(['--check'], env, root)
    expect(config).toMatchObject({ check: true, once: true, dryRun: true, host: 'example.org' })
    expect(config.ddnsStateFile).toBe(path.resolve(root, '../private-data/tmp/hostinger-ddns/last-confirmed-ip'))
    expect(config.stateDir).toBe(path.resolve(root, '../private-data/tmp/livekit-network-monitor'))
    expect(() => monitorConfiguration([], {}, root)).toThrow()
    expect(() => monitorConfiguration(['--ddns-state-file'], env, root)).toThrow()
    expect(() => monitorConfiguration(['--unknown'], env, root)).toThrow()
  })

  it('has one OS-owned guard and can acquire it again after release', async () => {
    const first = await acquireMonitorGuard(0)
    if (!first) throw new Error('Expected first guard')
    const address = first.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP address')
    let next = null
    try {
      expect(await acquireMonitorGuard(address.port)).toBeNull()
      await new Promise<void>((resolve) => first.close(() => resolve()))
      next = await acquireMonitorGuard(address.port)
      expect(next).not.toBeNull()
    } finally {
      if (first.listening) await new Promise<void>((resolve) => first.close(() => resolve()))
      if (next) await new Promise<void>((resolve) => next.close(() => resolve()))
    }
  })

  it('keeps only owned logs for at most seven days and caps daily size at 64 KiB', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sefer-monitor-test-'))
    if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) ||
        !path.basename(directory).startsWith('sefer-monitor-test-')) throw new Error('Unsafe temporary test directory')
    const timestamp = Date.parse('2026-10-05T12:00:00Z')
    const today = path.join(directory, 'events-2026-10-05.jsonl')
    try {
      await writeFile(path.join(directory, 'events-2026-09-27.jsonl'), 'old')
      await writeFile(path.join(directory, 'operator-unrelated.txt'), 'preserve')
      await writeFile(today, 'x'.repeat(64 * 1024))
      await writePrivateMonitorEvent(directory, 'WAIT_DNS', timestamp)
      expect(await readdir(directory)).toEqual(expect.arrayContaining(['operator-unrelated.txt', 'events-2026-10-05.jsonl']))
      expect(await readdir(directory)).not.toContain('events-2026-09-27.jsonl')
      expect(JSON.parse(await readFile(today, 'utf8'))).toEqual({ at: new Date(timestamp).toISOString(), event: 'WAIT_DNS' })
      expect(await readFile(path.join(directory, 'operator-unrelated.txt'), 'utf8')).toBe('preserve')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
