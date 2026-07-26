// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogViewer } from '../../src/components/catalog/CatalogViewer';
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
        catalog={{ id: 'public', path: '/public', title: 'Public', tags: ['public'] }}
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
});
