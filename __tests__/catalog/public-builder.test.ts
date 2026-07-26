import { describe, it, expect } from 'vitest'
import { buildPublicPresentations } from '../../server/public-presentations-builder.mjs'

describe('Public Presentations Builder', () => {
  const mockCatalogs = [
    { id: 'cat1', path: '/cat1', title: 'Cat 1', tags: ['tema1', 'tema2'] },
    { id: 'cat2', path: '/cat2', title: 'Cat 2', tags: ['tema3'] }
  ]

  it('filters out presentations with no tags or non-matching tags', () => {
    const presentations = [
      { id: 'p1', title: 'P1', tags: ['tema1'], slides: [] },
      { id: 'p2', title: 'P2', tags: ['tema4'], slides: [] },
      { id: 'p3', title: 'P3', tags: [], slides: [] },
      { id: 'p4', title: 'P4', slides: [] }
    ]

    const result = buildPublicPresentations(presentations, mockCatalogs)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })

  it('strips private fields and media/quiz slides from included presentations', () => {
    const presentations = [
      {
        id: 'p1',
        title: 'P1',
        tags: ['tema1', 'private_tag'],
        background: '/bg.png',
        slides: [
          { id: 's1', label: 'Slide 1', type: 'text', lines: ['A'], background: '/sbg.png' },
          { id: 's2', label: 'Quiz', type: 'quiz', quizData: {} },
          { id: 's3', label: 'Media', type: 'media', mediaSrc: '/video.mp4' },
          { id: 's4', label: '[IMAGE] pic', type: 'text' },
          { id: 's5', label: '[MEDIA] vid', type: 'text' }
        ]
      }
    ]

    const result = buildPublicPresentations(presentations, mockCatalogs)
    expect(result).toHaveLength(1)
    
    const p = result[0]
    expect(p.background).toBeUndefined()
    expect(p.tags).toEqual(['tema1']) // only public tags are kept

    expect(p.slides).toHaveLength(1)
    const s = p.slides[0]
    expect(s.id).toBe('s1')
    expect(s.background).toBeUndefined()
    expect(s.type).toBe('text')
  })

  it('returns empty array if catalogs have no tags', () => {
    const presentations = [{ id: 'p1', title: 'P1', tags: ['tema1'], slides: [] }]
    const result = buildPublicPresentations(presentations, [{ id: 'cat1', path: '/cat1', title: 'C', tags: [] }])
    expect(result).toHaveLength(0)
  })

  it('handles invalid inputs gracefully', () => {
    type PresentationsInput = Parameters<typeof buildPublicPresentations>[0]
    type CatalogsInput = Parameters<typeof buildPublicPresentations>[1]
    expect(buildPublicPresentations(null as unknown as PresentationsInput, mockCatalogs)).toEqual([])
    expect(buildPublicPresentations(undefined as unknown as PresentationsInput, mockCatalogs)).toEqual([])
    expect(buildPublicPresentations([], null as unknown as CatalogsInput)).toEqual([])
  })
})
