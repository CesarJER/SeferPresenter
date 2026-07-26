import type { Presentation } from '../types/presentation';
import { sanitizeSlideHtml } from './hebrewText';

export const normalizeCatalogSearch = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const isCatalogTitleSlide = (presentation: Presentation, slideIndex: number) => {
  if (slideIndex !== 0) return false;
  const titleText = (presentation.slides[0]?.lines?.[0] || '').trim();
  return Boolean(
    titleText &&
    normalizeCatalogSearch(presentation.title).includes(normalizeCatalogSearch(titleText))
  );
};

export const catalogTextToPlainText = (value: string) => {
  if (typeof document === 'undefined') return value.replace(/<[^>]*>/g, ' ');
  const element = document.createElement('div');
  element.innerHTML = sanitizeSlideHtml(value);
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
};

const getContentSlides = (presentation: Presentation) =>
  presentation.slides.filter((_, index) => !isCatalogTitleSlide(presentation, index));

export const getCatalogCardData = (presentation: Presentation, countSefer: boolean) => {
  const contentSlides = getContentSlides(presentation);
  const count = contentSlides.filter((slide) => (
    countSefer || (slide.type !== 'sefer' && slide.type !== 'tanaj')
  )).length;
  const excerptSlide = contentSlides[0];
  const excerptLines = (excerptSlide?.lines || [])
    .filter((line) => line && line !== '-' && line !== '>-')
    .map(catalogTextToPlainText)
    .filter(Boolean)
    .slice(0, 3);

  return { count, excerpt: excerptLines.join(' · ') };
};

export type HighlightSegment = { text: string; match: boolean };

export const splitCatalogHighlightedText = (value: string, query: string): HighlightSegment[] => {
  const normalizedQuery = normalizeCatalogSearch(query.trim());
  if (!normalizedQuery) return [{ text: value, match: false }];

  let normalizedValue = '';
  const starts: number[] = [];
  const ends: number[] = [];
  for (let offset = 0; offset < value.length;) {
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const end = offset + character.length;
    const normalizedCharacter = normalizeCatalogSearch(character);
    normalizedValue += normalizedCharacter;
    for (let index = 0; index < normalizedCharacter.length; index += 1) {
      starts.push(offset);
      ends.push(end);
    }
    offset = end;
  }

  const segments: HighlightSegment[] = [];
  let normalizedOffset = 0;
  let originalOffset = 0;
  while (normalizedOffset < normalizedValue.length) {
    const matchIndex = normalizedValue.indexOf(normalizedQuery, normalizedOffset);
    if (matchIndex < 0) break;
    const originalStart = starts[matchIndex];
    const originalEnd = ends[matchIndex + normalizedQuery.length - 1];
    if (originalStart > originalOffset) {
      segments.push({ text: value.slice(originalOffset, originalStart), match: false });
    }
    segments.push({ text: value.slice(originalStart, originalEnd), match: true });
    originalOffset = originalEnd;
    normalizedOffset = matchIndex + normalizedQuery.length;
  }
  if (originalOffset < value.length) segments.push({ text: value.slice(originalOffset), match: false });
  return segments.length > 0 ? segments : [{ text: value, match: false }];
};
