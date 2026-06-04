import { describe, expect, it } from 'vitest';
import {
  removeNiqqudFromPlainText,
  removeNiqqudPreserveHtml,
  sanitizeHtml,
  sanitizeSlideHtml,
} from '../../src/utils/hebrewText';

describe('hebrewText utilities', () => {
  describe('removeNiqqudFromPlainText', () => {
    it('removes nikud and points from plain Hebrew text', () => {
      // "בְּרֵאשִׁית בָּרָא אֱלֹהִים" -> "בראשית ברא אלהים"
      const withNikud = 'בְּרֵאשִׁית בָּרָא אֱלֹהִים';
      expect(removeNiqqudFromPlainText(withNikud)).toBe('בראשית ברא אלהים');
    });

    it('converts maqaf (u05BE) to spaces', () => {
      // "עַל־פִּי" (with maqaf \u05BE) -> "על פי"
      const withMaqaf = 'עַל\u05BEפִּי';
      expect(removeNiqqudFromPlainText(withMaqaf)).toBe('על פי');
    });

    it('removes parentheticals non-greedily', () => {
      // Single parenthetical
      expect(removeNiqqudFromPlainText('ויאמר (לודיים)')).toBe('ויאמר');
      
      // Multiple parentheticals on the same line (tests non-greedy fix!)
      const multiple = 'עכר (עוכר) של (ישראל)';
      expect(removeNiqqudFromPlainText(multiple)).toBe('עכר של');
    });
  });

  describe('removeNiqqudPreserveHtml', () => {
    it('removes nikud but preserves HTML tags intact', () => {
      const htmlInput = 'בְּרֵאשִׁית <span class="mam-kq"><span class="mam-kq-q">[לוּדִ֧ים]</span> <span class="mam-kq-k">(לודיים)</span></span> אֱלֹהִים';
      const expected = 'בראשית <span class="mam-kq"><span class="mam-kq-q">[לודים]</span> <span class="mam-kq-k">(לודיים)</span></span> אלהים';
      expect(removeNiqqudPreserveHtml(htmlInput)).toBe(expected);
    });
  });

  describe('sanitizeHtml', () => {
    it('allows permitted tags and attributes', () => {
      const input = '<div class="test" dir="rtl"><span title="hebrew">שָׁלוֹם</span><br/></div>';
      expect(sanitizeHtml(input)).toBe(input);
    });

    it('removes script and style tags completely', () => {
      const input = 'Hello <script>alert(1)</script><style>body { color: red; }</style>World';
      expect(sanitizeHtml(input)).toBe('Hello World');
    });

    it('strips illegal tags and attributes in fallback mode', () => {
      const input = '<p id="para" onclick="run()">Text <img src="x" onerror="bad()"></p>';
      // p and img are not allowed tags; onclick and id are not allowed attributes.
      const sanitized = sanitizeHtml(input);
      // It should strip the tags or convert them depending on the purifier/fallback
      expect(sanitized).not.toContain('onclick');
      expect(sanitized).not.toContain('onerror');
      expect(sanitized).not.toContain('<img');
    });
  });

  describe('sanitizeSlideHtml', () => {
    it('caches sanitization results', () => {
      const input = '<b>שָׁלוֹם</b>';
      const first = sanitizeSlideHtml(input);
      const second = sanitizeSlideHtml(input);
      expect(first).toBe(second);
      expect(first).toBe('<b>שָׁלוֹם</b>');
    });
  });
});
