import Papa from 'papaparse';
import DOMPurify from 'dompurify';
import type { VerseData } from '../hooks/useSeferReader';

export const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['br', 'span', 'sup', 'i', 'b', 'strong', 'em', 'u', 'small', 'mark', 'ruby', 'rt', 'rp', 'big', 'div'],
    ALLOWED_ATTR: ['class', 'dir', 'lang', 'title', 'data-comment'],
  });
};

const removeNiqqudFromPlainText = (text: string) =>
  text.replace(/־/g, ' ').replace(/[\u0591-\u05C7]/g, '').replace(/ \(.+\)/g, '');

const removeNiqqudPreserveHtml = (html: string): string => {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith('<') ? part : removeNiqqudFromPlainText(part)))
    .join('');
};

export const parseVerses = (source: string): VerseData[] => {
  const result = Papa.parse<VerseData>(source, {
    header: true,
    delimiter: '\t',
    skipEmptyLines: true,
  });

  return result.data
    .filter((row) => row.bookEs !== '')
    .map((row) => {
      let verseNikud = (row.verseNikud ?? '')
        .replace(/\{פ\}/g, '<br/>')
        .replace(/\{ס\}/g, '&emsp;&emsp;&emsp;')
        .replace(/\(פ\)/g, '<br/>')
        .replace(/\(ס\)/g, '&emsp;&emsp;&emsp;');

      verseNikud = verseNikud.replace(
        /<sup[^>]*class=["']*(?:""|)footnote-marker(?:""|)["']*[^>]*>\*<\/sup>\s*<(\w+)[^>]*class=["']*(?:""|)footnote(?:""|)["']*[^>]*>([\s\S]*?)<\/\1>/gi,
        (_match: string, _tag: string, content: string) => {
          const cleanContent = content.replace(/^\s*\(/, '').replace(/\)\s*$/, '');
          const escaped = cleanContent.replace(/"/g, '&quot;');
          return `<span class="variant-star cursor-pointer text-amber-600 font-bold" data-comment="${escaped}" title="${escaped}">*</span>`;
        }
      );

      const cleanText = verseNikud
        .replace(/<span[^>]*class=["']*(?:""|)mam-kq-q(?:""|)["']*[^>]*>.*?<\/span>/gi, '') // Remove Qere for clean version
        .replace(/(<span[^>]*class=["']*(?:""|)mam-kq-k(?:""|)["']*[^>]*>)\((.*?)\)(<\/span>)/gi, '$1$2$3<sup class="text-amber-600 ml-0.5">#</sup>') // Remove parens from Ketiv and add marker
        .replace(/\(([^)]+)\)\s*\[[^\]]+\]/g, '$1<sup class="text-amber-600 ml-0.5">#</sup>'); // Handle legacy (X) [Y] with marker

      const verseNikudClean = removeNiqqudPreserveHtml(cleanText);
      return {
        ...row,
        verseNikud,
        verseNikudClean,
        verseNikudSanitized: sanitizeHtml(verseNikud),
        verseNikudCleanSanitized: sanitizeHtml(verseNikudClean),
      };
    });
};
