import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Papa from 'papaparse'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVerses, readVoiceAliases } from '../scripts/generate-verses.js'

const temporaryDirectories: string[] = []
const originalSource = process.env.SEFER_VERSES_SOURCE
const originalDataDir = process.env.SEFER_DATA_DIR

const makeFixture = () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-generator-data-'))
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-generator-source-'))
  temporaryDirectories.push(dataDir, sourceDir)
  const sourcePath = path.join(sourceDir, 'verses.tsv')
  fs.writeFileSync(
    sourcePath,
    'bookEs\tbookAbbrevEs\tbookHeb\tchapter\tverse\thebrew\ttransliteration\ttranslation\nLibro Alfa\tA\tא\t1\t1\tHEB\tTRANS\tTEXT\n',
  )
  process.env.SEFER_DATA_DIR = dataDir
  process.env.SEFER_VERSES_SOURCE = sourcePath
  return { dataDir, sourcePath }
}

afterEach(() => {
  if (originalSource === undefined) delete process.env.SEFER_VERSES_SOURCE
  else process.env.SEFER_VERSES_SOURCE = originalSource
  if (originalDataDir === undefined) delete process.env.SEFER_DATA_DIR
  else process.env.SEFER_DATA_DIR = originalDataDir
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('scripture generator', () => {
  it('warns and leaves the data directory untouched when the configured source is missing', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-generator-data-'))
    temporaryDirectories.push(dataDir)
    process.env.SEFER_DATA_DIR = dataDir
    process.env.SEFER_VERSES_SOURCE = path.join(dataDir, 'missing.tsv')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    generateVerses()
    expect(warn).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(dataDir, 'public'))).toBe(false)
  })

  it('writes only its books and metadata below SEFER_DATA_DIR/public', () => {
    const { dataDir, sourcePath } = makeFixture()
    const unrelatedPath = path.join(dataDir, 'public', 'other-corpus', 'index.json')
    fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true })
    fs.writeFileSync(unrelatedPath, '{}\n')

    generateVerses()
    expect(fs.existsSync(path.join(dataDir, 'public', 'books', 'libro_alfa.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'public', 'metadata.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dataDir, 'config', 'verses-source.sha256'), 'utf8')).toMatch(/^[a-f0-9]{64}\n$/)
    expect(fs.readFileSync(unrelatedPath, 'utf8')).toBe('{}\n')

    const parse = vi.spyOn(Papa, 'parse')
    generateVerses()
    expect(parse).not.toHaveBeenCalled()

    fs.appendFileSync(
      sourcePath,
      'Libro Alfa\tA\tא\t1\t2\tHEB2\tTRANS2\tTEXT2\n',
    )
    generateVerses()
    expect(parse).toHaveBeenCalledOnce()
    expect(fs.readFileSync(unrelatedPath, 'utf8')).toBe('{}\n')
  })

  it('regenerates metadata when only the private aliases change', () => {
    const { dataDir } = makeFixture()
    const aliasesPath = path.join(dataDir, 'config', 'voice_aliases.json')
    fs.mkdirSync(path.dirname(aliasesPath), { recursive: true })
    fs.writeFileSync(aliasesPath, JSON.stringify({ 'Libro Alfa': ['alfa uno'] }))

    generateVerses()
    const parse = vi.spyOn(Papa, 'parse')
    fs.writeFileSync(aliasesPath, JSON.stringify({ 'Libro Alfa': ['alfa dos'] }))
    generateVerses()

    expect(parse).toHaveBeenCalledOnce()
    const metadata = JSON.parse(fs.readFileSync(path.join(dataDir, 'public', 'metadata.json'), 'utf8'))
    expect(metadata['Libro Alfa'].voiceAliases).toEqual(['alfa dos'])
  })

  it('rejects malformed private alias data instead of generating incomplete metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-voice-aliases-'))
    temporaryDirectories.push(directory)
    const aliasesPath = path.join(directory, 'voice_aliases.json')
    fs.writeFileSync(aliasesPath, JSON.stringify({ 'Libro Alfa': ['válido', 4] }))

    expect(() => readVoiceAliases(aliasesPath)).toThrow('Aliases de voz inválidos')
  })
})
