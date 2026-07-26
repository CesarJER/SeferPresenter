import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildOperatorManifest,
  readPrivacyLocalMarkdown,
  validateOperatorManifestFile,
} from '../server/operator-config.mjs'

const validEnv = {
  VITE_ORGANIZATION_NAME: 'Example Operator',
  VITE_ORGANIZATION_EMAIL: 'rights@example.org',
  VITE_ORGANIZATION_LEGAL_ID: '',
  VITE_ORGANIZATION_WEBSITE: 'https://example.org',
  VITE_SEFER_LEGAL_BASIS: 'Basis declared by the operator',
  VITE_SEFER_PRIVACY_URL: '/proteccion-datos',
  VITE_SEFER_RECORDING_AVAILABLE: 'true',
  VITE_SEFER_RECORDING_DEFAULT: 'NOT_RECORDING',
  VITE_SEFER_RECORDING_MUTABLE: 'true',
  VITE_SEFER_SESSION_ACCESS_DEFAULT: 'CONTROLLED',
}

const temporaryDirectories: string[] = []
const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-operator-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('operator configuration', () => {
  it('builds a normalized public manifest from complete configuration', () => {
    expect(buildOperatorManifest(validEnv)).toMatchObject({
      schemaVersion: 1,
      operatorName: 'Example Operator',
      recordingAvailable: true,
      recordingDefault: 'NOT_RECORDING',
      recordingMutable: true,
      accessDefault: 'CONTROLLED',
    })
  })

  it.each([
    'VITE_ORGANIZATION_NAME',
    'VITE_ORGANIZATION_EMAIL',
    'VITE_SEFER_LEGAL_BASIS',
    'VITE_SEFER_PRIVACY_URL',
    'VITE_SEFER_RECORDING_AVAILABLE',
    'VITE_SEFER_RECORDING_DEFAULT',
    'VITE_SEFER_RECORDING_MUTABLE',
    'VITE_SEFER_SESSION_ACCESS_DEFAULT',
  ])('rejects missing required field %s', (field) => {
    expect(() => buildOperatorManifest({ ...validEnv, [field]: '' }))
      .toThrow(`Invalid operator configuration`)
  })

  it('rejects incompatible recording policy and unsafe URLs', () => {
    expect(() => buildOperatorManifest({
      ...validEnv,
      VITE_SEFER_RECORDING_AVAILABLE: 'false',
      VITE_SEFER_RECORDING_DEFAULT: 'RECORDING',
      VITE_SEFER_PRIVACY_URL: 'javascript:alert(1)',
    })).toThrow(/cannot be RECORDING/)
  })

  it('rejects a build/runtime access policy mismatch', () => {
    const directory = makeTemporaryDirectory()
    const manifest = buildOperatorManifest(validEnv)
    fs.writeFileSync(path.join(directory, 'operator-manifest.json'), JSON.stringify(manifest))
    expect(() => validateOperatorManifestFile(directory, {
      SEFER_SESSION_ACCESS_DEFAULT: 'PUBLIC',
    })).toThrow(/does not match/)
  })
})

describe('privacy.local.md validation', () => {
  it('accepts a bounded UTF-8 Markdown file and strips its BOM', () => {
    const directory = makeTemporaryDirectory()
    const filePath = path.join(directory, 'privacy.local.md')
    fs.writeFileSync(filePath, '\uFEFF# Local policy\n')
    expect(readPrivacyLocalMarkdown(filePath)).toBe('# Local policy\n')
  })

  it('treats a missing local document as optional', () => {
    expect(readPrivacyLocalMarkdown(path.join(makeTemporaryDirectory(), 'missing.md'))).toBeNull()
  })

  it('rejects empty, non-file and NUL-containing inputs', () => {
    const directory = makeTemporaryDirectory()
    const emptyPath = path.join(directory, 'empty.md')
    const nulPath = path.join(directory, 'nul.md')
    fs.writeFileSync(emptyPath, '')
    fs.writeFileSync(nulPath, 'invalid\0markdown')

    expect(() => readPrivacyLocalMarkdown(emptyPath)).toThrow(/between 1 byte/)
    expect(() => readPrivacyLocalMarkdown(directory)).toThrow(/not a file/)
    expect(() => readPrivacyLocalMarkdown(nulPath)).toThrow(/NUL/)
  })

  it('rejects invalid UTF-8', () => {
    const filePath = path.join(makeTemporaryDirectory(), 'invalid.md')
    fs.writeFileSync(filePath, Buffer.from([0xc3, 0x28]))
    expect(() => readPrivacyLocalMarkdown(filePath)).toThrow(/valid UTF-8/)
  })
})
