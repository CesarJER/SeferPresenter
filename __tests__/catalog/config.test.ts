import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import { parsePublicCatalogs } from '../../server/public-catalog-config.mjs'

describe('Public Catalogs Config Parser', () => {
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('parses valid JSON with one catalog', () => {
    const json = JSON.stringify([{
      id: 'test_catalog',
      path: '/test_catalog',
      title: 'Test Catalog',
      description: 'A catalog for testing',
      tags: ['tag1', 'tag2']
    }])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('test_catalog')
    expect(result[0].path).toBe('/test_catalog')
    expect(result[0].title).toBe('Test Catalog')
    expect(result[0].description).toBe('A catalog for testing')
    expect(result[0].tags).toEqual(['tag1', 'tag2'])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('parses valid JSON with multiple catalogs', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/cat1', title: 'Cat 1', tags: ['t1'] },
      { id: 'cat2', path: '/cat2', title: 'Cat 2', tags: ['t2'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(2)
  })

  it('fails on duplicate IDs and returns empty array', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/cat1', title: 'Cat 1', tags: ['t1'] },
      { id: 'cat1', path: '/cat2', title: 'Cat 2', tags: ['t2'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate catalog id 'cat1'"))
  })

  it('fails on duplicate paths and returns empty array', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/cat', title: 'Cat 1', tags: ['t1'] },
      { id: 'cat2', path: '/cat', title: 'Cat 2', tags: ['t2'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Duplicate catalog path '/cat'"))
  })

  it('fails on reserved paths and returns empty array', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/audience', title: 'Cat 1', tags: ['t1'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("reserved path '/audience'"))
  })

  it('normalizes paths with missing leading slash or trailing slash', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: 'cat1/', title: 'Cat 1', tags: ['t1'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result[0].path).toBe('/cat1')
  })

  it('normalizes and dedupes tags, removing empty ones', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/cat1', title: 'Cat 1', tags: [' t1 ', '', 't2', 't1'] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result[0].tags).toEqual(['t1', 't2'])
  })

  it('fails if catalog has no valid tags', () => {
    const json = JSON.stringify([
      { id: 'cat1', path: '/cat1', title: 'Cat 1', tags: ['  ', ''] }
    ])
    const result = parsePublicCatalogs(json)
    expect(result).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("must have at least one valid tag"))
  })

  it('handles invalid JSON gracefully', () => {
    const result = parsePublicCatalogs('invalid json')
    expect(result).toHaveLength(0)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid JSON'), expect.any(Error))
  })

  it('handles missing title or path', () => {
    const json1 = JSON.stringify([{ id: 'cat1', title: 'Cat 1', tags: ['t1'] }])
    expect(parsePublicCatalogs(json1)).toHaveLength(0)

    const json2 = JSON.stringify([{ id: 'cat1', path: '/cat1', tags: ['t1'] }])
    expect(parsePublicCatalogs(json2)).toHaveLength(0)
  })
})
