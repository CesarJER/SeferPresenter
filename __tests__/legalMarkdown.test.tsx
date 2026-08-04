// @vitest-environment jsdom

import React from 'react';
import { webcrypto } from 'node:crypto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegalMarkdown } from '../src/components/shared/LegalMarkdown';
import DataProtectionPage from '../src/components/shared/DataProtectionPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('legal Markdown presentation', () => {
  it('renders GFM tables and removes raw HTML', () => {
    render(
      <LegalMarkdown>{`| Campo | Valor |\n| --- | --- |\n| Responsable | Operador |\n\n<script>alert('x')</script>`}</LegalMarkdown>,
    );

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Responsable')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.queryByText(/alert/)).toBeNull();
  });

  it('shows title, version and the full hash without exposing the internal source path', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => '# Política legible\n\nVersión: visual-1\n\n## Responsable\n\nContenido.',
    })));

    render(<DataProtectionPage />);

    const scrollRegion = document.querySelector('main');
    expect(scrollRegion?.className).toContain('h-dvh');
    expect(scrollRegion?.className).toContain('overflow-y-auto');
    expect(await screen.findByRole('heading', { name: 'Política legible' })).toBeTruthy();
    expect(screen.getByText('Versión visual-1')).toBeTruthy();
    expect(screen.getByText(/SHA-256 [a-f0-9]{64}/)).toBeTruthy();
    expect(screen.queryByText(/Fuente legal/i)).toBeNull();
    expect(screen.queryByText(/\/legal\//)).toBeNull();
  });

});
