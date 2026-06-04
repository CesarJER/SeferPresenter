import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['br', 'span', 'sup', 'i', 'b', 'strong', 'em', 'u', 'small', 'mark', 'ruby', 'rt', 'rp', 'big', 'div'];
const ALLOWED_ATTR = ['class', 'dir', 'lang', 'title', 'data-comment'];
const allowedTagSet = new Set(ALLOWED_TAGS);
const allowedAttrSet = new Set(ALLOWED_ATTR);
const slideHtmlCache = new Map<string, string>();
const SLIDE_HTML_CACHE_LIMIT = 5000;

const fallbackSanitizeHtml = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTagSet.has(tag)) return '';
      if (match.startsWith('</')) return `</${tag}>`;

      const attrs: string[] = [];
      rawAttrs.replace(/\s+([a-z0-9-:]+)(?:=(["'])(.*?)\2)?/gi, (_attrMatch, rawName: string, _quote: string, rawValue: string) => {
        const name = rawName.toLowerCase();
        if (!allowedAttrSet.has(name)) return '';
        const value = String(rawValue ?? '').replace(/"/g, '&quot;');
        attrs.push(value ? `${name}="${value}"` : name);
        return '';
      });

      const suffix = match.endsWith('/>') || tag === 'br' ? '/>' : '>';
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}${suffix}`;
    });
};

export const sanitizeHtml = (html: string): string => {
  const purifier = DOMPurify as unknown as { sanitize?: (dirty: string, config: unknown) => string };
  if (typeof purifier.sanitize === 'function') {
    return purifier.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
    });
  }

  return fallbackSanitizeHtml(html);
};

export const sanitizeSlideHtml = (html: string): string => {
  const cached = slideHtmlCache.get(html);
  if (cached !== undefined) return cached;

  const clean = sanitizeHtml(html);
  if (slideHtmlCache.size >= SLIDE_HTML_CACHE_LIMIT) {
    const firstKey = slideHtmlCache.keys().next().value;
    if (firstKey !== undefined) slideHtmlCache.delete(firstKey);
  }
  slideHtmlCache.set(html, clean);
  return clean;
};

export const removeNiqqudFromPlainText = (text: string) =>
  text.replace(/\u05BE/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/ \([^)]+\)/g, '');

export const removeNiqqudPreserveHtml = (html: string): string => {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : removeNiqqudFromPlainText(part)))
    .join('');
};
