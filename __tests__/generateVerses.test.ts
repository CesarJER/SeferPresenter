import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Papa from 'papaparse'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateVerses } from '../scripts/generate-verses.js'

const temporaryDirectories: string[] = []
const originalSource = process.env.SEFER_VERSES_SOURCE
const originalDataDir = process.env.SEFER_DATA_DIR

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
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-generator-data-'))
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sefer-generator-source-'))
    temporaryDirectories.push(dataDir, sourceDir)
    const sourcePath = path.join(sourceDir, 'verses.tsv')
    const unrelatedPath = path.join(dataDir, 'public', 'talmud', 'index.json')
    fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true })
    fs.writeFileSync(unrelatedPath, '{}\n')
    fs.writeFileSync(
      sourcePath,
      'bookEs\tbookAbbrevEs\tbookHeb\tchapter\tverse\thebrew\ttransliteration\ttranslation\nGenesis\tGn\tBereshit\t1\t1\tHEB\tTRANS\tTEXT\n',
    )
    process.env.SEFER_DATA_DIR = dataDir
    process.env.SEFER_VERSES_SOURCE = sourcePath

    generateVerses()
    expect(fs.existsSync(path.join(dataDir, 'public', 'books', 'genesis.tsv'))).toBe(true)
    expect(fs.existsSync(path.join(dataDir, 'public', 'metadata.json'))).toBe(true)
    expect(fs.readFileSync(path.join(dataDir, 'config', 'verses-source.sha256'), 'utf8')).toMatch(/^[a-f0-9]{64}\n$/)
    expect(fs.readFileSync(unrelatedPath, 'utf8')).toBe('{}\n')

    const parse = vi.spyOn(Papa, 'parse')
    generateVerses()
    expect(parse).not.toHaveBeenCalled()

    fs.appendFileSync(
      sourcePath,
      'Genesis\tGn\tBereshit\t1\t2\tHEB2\tTRANS2\tTEXT2\n',
    )
    generateVerses()
    expect(parse).toHaveBeenCalledOnce()
    expect(fs.readFileSync(unrelatedPath, 'utf8')).toBe('{}\n')
  })
})
