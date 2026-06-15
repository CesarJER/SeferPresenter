import type { Presentation, PresentationStep } from '../types/presentation';
import { generateQuizSubslides } from './quizUtils';

export function generatePresentationSteps(presentation: Presentation): PresentationStep[] {
  const steps: PresentationStep[] = [];

  presentation.slides.forEach((slide, slideIndex) => {
    if (slide.type === 'quiz' && slide.quizData) {
      const subslides = generateQuizSubslides(slide.quizData);
      subslides.forEach((_, subslideIndex) => {
        steps.push({
          type: 'quiz',
          slideIndex,
          subslideIndex,
        });
      });
    } else if (
      (slide.type === 'sefer' || slide.type === 'tanaj') &&
      slide.scriptureBook &&
      slide.scriptureChapter &&
      slide.scriptureVerseStart
    ) {
      const start = parseInt(slide.scriptureVerseStart, 10);
      const end = slide.scriptureVerseEnd ? parseInt(slide.scriptureVerseEnd, 10) : start;
      const resolvedStart = isNaN(start) ? 1 : start;
      const resolvedEnd = isNaN(end) ? resolvedStart : end;

      for (let v = resolvedStart; v <= resolvedEnd; v++) {
        steps.push({
          type: 'scripture',
          slideIndex,
          book: slide.scriptureBook,
          chapter: slide.scriptureChapter,
          verse: String(v),
        });
      }
    } else {
      steps.push({
        type: 'normal',
        slideIndex,
      });
    }
  });

  return steps;
}
