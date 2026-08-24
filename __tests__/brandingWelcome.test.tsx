// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { BrandingWelcome } from '../src/components/shared/BrandingWelcome';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BrandingWelcome', () => {
  it('loads instance Markdown, allows images and omits raw HTML', async () => {
    const fetchMock = vi.fn(async () => new Response([
      '# Instance welcome',
      '',
      '<script>window.compromised = true</script>',
      '',
      '![tracking](https://example.test/pixel.png)',
    ].join('\n'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<BrandingWelcome />);

    expect(await screen.findByRole('heading', { name: 'Instance welcome' })).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.test/pixel.png');
    expect(fetchMock).toHaveBeenCalledWith('/api/branding/welcome.md', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
  });

  it('renders nothing when the endpoint is unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<BrandingWelcome />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(container.innerHTML).toBe('');
  });
});
