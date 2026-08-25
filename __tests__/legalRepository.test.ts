import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLegalRepository } from '../server/legal-repository.mjs'

const temporaryDirectories: string[] = []
const hash = (contents: string | Buffer) => createHash('sha256').update(contents).digest('hex')

const makeDataDir = () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-legal-'))
  temporaryDirectories.push(dataDir)
  fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true })
  return dataDir
}

const writeRelease = (dataDir: string, sequence: number, previousManifestSha256: string | null) => {
  const releaseDir = path.join(dataDir, 'legal', 'releases', String(sequence).padStart(6, '0'))
  fs.mkdirSync(releaseDir, { recursive: true })
  const policy = `# Policy\n\nVersion ${sequence}\n`
  const summary = `# Summary\n\nVersion ${sequence}\n`
  fs.writeFileSync(path.join(releaseDir, 'privacy-policy.md'), policy)
  fs.writeFileSync(path.join(releaseDir, 'privacy-summary.md'), summary)
  const manifest = {
    schemaVersion: 1,
    sequence,
    version: `test-${sequence}`,
    status: 'test',
    effectiveDate: null,
    previousManifestSha256,
    documents: {
      privacyPolicy: { file: 'privacy-policy.md', sha256: hash(policy) },
      privacySummary: { file: 'privacy-summary.md', sha256: hash(summary) },
    },
  }
  const manifestContents = `${JSON.stringify(manifest, null, 2)}\n`
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifestContents)
  return hash(manifestContents)
}

const activate = (dataDir: string, sequence: number, manifestSha256: string) => {
  fs.writeFileSync(path.join(dataDir, 'legal', 'current.json'), `${JSON.stringify({
    schemaVersion: 1,
    sequence,
    manifestSha256,
  }, null, 2)}\n`)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('legal repository', () => {
  it('activates a verified release and records a durable anti-rollback anchor', () => {
    const dataDir = makeDataDir()
    const manifestSha256 = writeRelease(dataDir, 1, null)
    activate(dataDir, 1, manifestSha256)

    const legal = loadLegalRepository({ dataDir, now: () => '2026-08-25T00:00:00.000Z' })

    expect(legal.status).toBe('ACTIVE')
    expect(legal.publicManifest).toMatchObject({ sequence: 1, manifestSha256 })
    expect(fs.existsSync(legal.documents.privacyPolicy)).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'config', 'legal-activation.json'), 'utf8')))
      .toMatchObject({ maxSequence: 1, manifestSha256 })

    fs.writeFileSync(path.join(dataDir, 'config', 'legal-activation.json'), JSON.stringify({
      schemaVersion: 1,
      maxSequence: 1,
      manifestSha256: '0'.repeat(64),
    }))
    expect(() => loadLegalRepository({ dataDir })).toThrow('LEGAL_ROLLBACK_DETECTED')
  })

  it('rejects document tampering and rollback to an already superseded release', () => {
    const dataDir = makeDataDir()
    const firstHash = writeRelease(dataDir, 1, null)
    activate(dataDir, 1, firstHash)
    loadLegalRepository({ dataDir })

    fs.appendFileSync(path.join(dataDir, 'legal', 'releases', '000001', 'privacy-policy.md'), 'tampered')
    expect(() => loadLegalRepository({ dataDir })).toThrow('Legal document hash mismatch')
    fs.writeFileSync(path.join(dataDir, 'legal', 'releases', '000001', 'privacy-policy.md'), '# Policy\n\nVersion 1\n')

    const secondHash = writeRelease(dataDir, 2, firstHash)
    activate(dataDir, 2, secondHash)
    loadLegalRepository({ dataDir })
    activate(dataDir, 1, firstHash)

    expect(() => loadLegalRepository({ dataDir })).toThrow('LEGAL_ROLLBACK_DETECTED')
  })

  it('rejects a release whose previous-manifest link is broken', () => {
    const dataDir = makeDataDir()
    writeRelease(dataDir, 1, null)
    const secondHash = writeRelease(dataDir, 2, '0'.repeat(64))
    activate(dataDir, 2, secondHash)

    expect(() => loadLegalRepository({ dataDir })).toThrow('Legal manifest chain is invalid')
  })

  it('allows startup without an operator legal repository', () => {
    expect(loadLegalRepository({ dataDir: makeDataDir() })).toEqual({ status: 'LEGAL_NOT_CONFIGURED' })
  })
})
