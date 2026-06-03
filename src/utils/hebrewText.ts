import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['br', 'span', 'sup', 'i', 'b', 'strong', 'em', 'u', 'small', 'mark', 'ruby', 'rt', 'rp', 'big', 'div'];
const ALLOWED_ATTR = ['class', 'dir', 'lang', 'title', 'data-comment'];

const fallbackSanitizeHtml = (html: string): string => {
  const allowedTags = new Set(ALLOWED_TAGS);
  const allowedAttrs = new Set(ALLOWED_ATTR);

  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (match, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (!allowedTags.has(tag)) return '';
      if (match.startsWith('</')) return `</${tag}>`;

      const attrs: string[] = [];
      rawAttrs.replace(/\s+([a-z0-9-:]+)(?:=(["'])(.*?)\2)?/gi, (_attrMatch, rawName: string, _quote: string, rawValue: string) => {
        const name = rawName.toLowerCase();
        if (!allowedAttrs.has(name)) return '';
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

export const sanitizeSlideHtml = (html: string): string => sanitizeHtml(html);

export const removeNiqqudFromPlainText = (text: string) =>
  text.replace(/\u05BE/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/ \(.+\)/g, '');

export const removeNiqqudPreserveHtml = (html: string): string => {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : removeNiqqudFromPlainText(part)))
    .join('');
};
