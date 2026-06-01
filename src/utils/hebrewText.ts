import DOMPurify from 'dompurify';

export const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['br', 'span', 'sup', 'i', 'b', 'strong', 'em', 'u', 'small', 'mark', 'ruby', 'rt', 'rp', 'big', 'div'],
    ALLOWED_ATTR: ['class', 'dir', 'lang', 'title', 'data-comment'],
  });
};

export const removeNiqqudFromPlainText = (text: string) =>
  text.replace(/\u05BE/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/ \(.+\)/g, '');

export const removeNiqqudPreserveHtml = (html: string): string => {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : removeNiqqudFromPlainText(part)))
    .join('');
};
