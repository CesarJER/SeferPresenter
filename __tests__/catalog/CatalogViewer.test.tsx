// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogViewer } from '../../src/components/catalog/CatalogViewer';
import { getCatalogCardData, splitCatalogHighlightedText } from '../../src/utils/catalogCards';
import type { Presentation } from '../../src/types/presentation';

describe('CatalogViewer HTML safety', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('sanitizes public slide and scripture HTML before rendering it', async () => {
    const presentations: Presentation[] = [{
      id: 'public-presentation',
      title: 'Public presentation',
      mode: 'trilingual',
      slides: [{
        id: 'unsafe-slide',
        label: 'Unsafe',
        lines: [
          '<img src=x onerror="globalThis.catalogXss=true"><strong>Safe</strong>',
          '<a href="javascript:alert(1)">link</a>',
          '<span onclick="alert(1)">text</span>',
        ],
        scriptureVerses: [[
          '<svg onload="alert(1)"></svg><em>Verse</em>',
          '-',
          '>-',
        ]],
      }],
    }];

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => presentations,
    }));

    const { container } = render(
      <CatalogViewer
        catalog={{ id: 'public', path: '/public', title: 'Public', tags: ['public'], count_sefer: false }}
        presentationId="public-presentation"
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('Verse'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg[onload]')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(container.querySelector('[onclick]')).toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('Verse');
  });

  it('counts reference slides only when the catalog enables count_sefer', () => {
    const presentation: Presentation = {
      id: 'study',
      title: 'Study',
      background: '',
      mode: 'standard',
      slides: [
        { id: 'title', label: 'Title', lines: ['Study'] },
        { id: 'content', label: 'Content', lines: ['Text'] },
        { id: 'tanaj', label: 'Reference', type: 'tanaj', lines: ['Reference'] },
      ],
    };

    expect(getCatalogCardData(presentation, false).count).toBe(1);
    expect(getCatalogCardData(presentation, true).count).toBe(2);
    expect(splitCatalogHighlightedText('Moisés', 'moises')).toContainEqual({ text: 'Moisés', match: true });
  });

  it('shows the non-title excerpt, configurable count, and safe accent-insensitive highlights', async () => {
    const presentations: Presentation[] = [{
      id: 'study',
      title: 'Estudio de Moisés',
      background: '',
      mode: 'standard',
      slides: [
        { id: 'title', label: 'Title', lines: ['Estudio de Moisés'] },
        { id: 'content', label: 'Content', lines: ['Moisés recibió instrucciones', 'Segunda línea'] },
        { id: 'reference', label: 'Reference', type: 'sefer', lines: ['Referencia adicional'] },
      ],
    }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => presentations,
    }));

    const { container, getByPlaceholderText } = render(
      <CatalogViewer
        catalog={{ id: 'public', path: '/public', title: 'Public', tags: ['public'], count_sefer: false }}
        presentationId={null}
      />,
    );

    await waitFor(() => expect(container.textContent).toContain('(1)'));
    expect(container.textContent).toContain('Moisés recibió instrucciones');
    expect(container.textContent).not.toContain('(3)');

    const search = getByPlaceholderText(/Buscar/i);
    fireEvent.change(search, { target: { value: 'moises' } });

    await waitFor(() => {
      expect(Array.from(container.querySelectorAll('mark')).some(mark => mark.textContent === 'Moisés')).toBe(true);
    });
  });
});
