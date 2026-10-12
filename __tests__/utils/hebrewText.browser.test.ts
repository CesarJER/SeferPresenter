// @vitest-environment jsdom
import DOMPurify from 'dompurify';
import { expect, it } from 'vitest';
import { sanitizeSlideHtml } from '../../src/utils/hebrewText';

it('uses DOMPurify to remove executable markup and preserve Hebrew formatting', () => {
  expect(typeof DOMPurify.sanitize).toBe('function');
  const container = document.createElement('div');
  container.innerHTML = sanitizeSlideHtml(
    '<div dir="rtl"><span class="hebrew" onclick="alert(1)">שָׁלוֹם</span>' +
    '<ruby>א<rt>aleph</rt></ruby><br><script>alert(1)</script><img src=x onerror="alert(1)"></div>',
  );
  expect(container.querySelector('script, img, [onclick], [onerror]')).toBeNull();
  expect(container.querySelector('div')?.getAttribute('dir')).toBe('rtl');
  expect(container.querySelector('span.hebrew')?.textContent).toBe('שָׁלוֹם');
  expect(container.querySelector('ruby rt')?.textContent).toBe('aleph');
  expect(container.querySelector('br')).not.toBeNull();
});
