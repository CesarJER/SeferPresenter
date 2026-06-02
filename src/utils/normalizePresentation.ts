import type { Presentation } from '../types/presentation';

// ── URL helpers ───────────────────────────────────────────────────
export const parseSlideHash = (hash: string) => {
  const clean = hash.replace('#', '');
  const [slidePart, versePart] = clean.split('.');
  const slideIndex = parseInt(slidePart, 10);
  return {
    slideIndex,
    verse: versePart || undefined,
  };
};

export const formatSlideHash = (slideIndex: number, verse?: string) =>
  verse ? `#${slideIndex}.${verse}` : `#${slideIndex}`;

export const makeClientId = () => {
  const randomPart = Math.random().toString(36).slice(2);
  return `sefer-${Date.now().toString(36)}-${randomPart}`;
};

export const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, '-')           // spaces → hyphens
    .replace(/[^\w-]+/g, '')        // remove non-word chars
    .replace(/--+/g, '-')           // collapse multiple hyphens
    .replace(/^-+/, '')             // trim leading hyphens
    .replace(/-+$/, '');            // trim trailing hyphens
};

// ── Path normalization ────────────────────────────────────────────
export const normalizePublicPath = (value: string) => {
  if (!value) return '';

  let normalized = value.replace(/\\/g, '/');
  const publicIndex = normalized.lastIndexOf('/public/');
  if (publicIndex >= 0) {
    normalized = normalized.slice(publicIndex + '/public'.length);
  } else if (normalized.startsWith('public/')) {
    normalized = `/${normalized.slice('public/'.length)}`;
  }

  if (__APP_MODE__ === 'singlefile') {
    return normalized.startsWith('/') ? normalized.slice(1) : normalized;
  } else {
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
};

// ── Presentation normalization ────────────────────────────────────
export const normalizePresentation = (presentation: Presentation): Presentation => {
  let mode = presentation.mode || 'standard';
  let slides = presentation.slides || [];


  if (mode === 'trilingual' && slides.length > 0) {
    const allSlidesAreFallback = slides.every(slide => {
      const l1 = slide.lines[1] ?? '';
      const l2 = slide.lines[2] ?? '';
      const isL1Fallback = l1 === '-' || l1 === '>-' || l1 === '';
      const isL2Fallback = l2 === '-' || l2 === '>-' || l2 === '';
      return isL1Fallback && isL2Fallback;
    });

    if (allSlidesAreFallback) {
      mode = 'standard';
    }
  }

  slides = slides.map((slide) => {
    const fallbackVal = '-';
    let l1 = slide.lines[1];
    let l2 = slide.lines[2];

    if (mode === 'standard') {
      l1 = fallbackVal;
      l2 = fallbackVal;
    } else {
      l1 = l1 !== undefined && l1 !== '' ? l1 : fallbackVal;
      l2 = l2 !== undefined && l2 !== '' ? l2 : fallbackVal;
    }

    return {
      ...slide,
      lines: [slide.lines[0] || '', l1, l2]
    };
  });

  return {
    ...presentation,
    mode,
    slides,
    background: normalizePublicPath(presentation.background),
    fontScale: presentation.fontScale ?? 1
  };
};

// ── Persistent state loader ───────────────────────────────────────
export const loadStoredPresenterState = (): { presentation: Presentation | null; slideIndex: number } | null => {
  try {
    const stored = localStorage.getItem('sefer-presenter-state');
    if (!stored) return null;

    const data = JSON.parse(stored);
    return {
      presentation: data.presentation ? normalizePresentation(data.presentation) : null,
      slideIndex: data.slideIndex
    };
  } catch (err) {
    console.error('Error loading stored presenter state', err);
    return null;
  }
};

// ── Default backgrounds ───────────────────────────────────────────
export const fallbackBackgrounds = [
  '/backgrounds/Jerusalem/Jerusalem-0.0Midday.png',
  '/backgrounds/Jerusalem/Jerusalem-0.1AfterMidday.png',
  '/backgrounds/Jerusalem/Jerusalem-0.2Afternoon.png',
  '/backgrounds/Jerusalem/Jerusalem-0.3LateAfternoon.png',
  '/backgrounds/Jerusalem/Jerusalem-0.4Sunset.png',
  '/backgrounds/Jerusalem/Jerusalem-1NewMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-2WaxingCrescentMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-3CrescentQuarterMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-4WaxingGibbousMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-5FullMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-6WaningGibbousMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-7DecrescentQuarterMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-8WaningCrescentMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-9NoMoon.png',
  '/backgrounds/Jerusalem/Jerusalem-Video-pingpong.mp4',
  '/backgrounds/Jerusalem/Jerusalem-Video.mp4',
  '/backgrounds/Zarza/Zarza ardiente-pingpong.mp4',
  '/backgrounds/Zarza/Zarza ardiente.mp4',
  '/backgrounds/Zarza/Zarza ardiente.png'
];
