import type { Slide } from '../types/presentation';

export const isImageMedia = (src?: string | null): boolean => {
  if (!src) return false;
  const ext = src.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext || '');
};

export const serializeMediaToText = (slide: Partial<Slide>): string => {
  const parts: string[] = ['[MEDIA'];
  
  parts.push(`"${slide.mediaSrc || ''}"`);
  parts.push(slide.mediaFit || 'cover');
  parts.push(slide.mediaPresenterNav !== false ? '1' : '0');
  parts.push(slide.mediaShowBg ? '1' : '0');
  parts.push(slide.mediaLoop !== false ? '1' : '0');
  parts.push(`${slide.mediaVolume ?? 1}`);
  parts.push(`${slide.mediaSpeed ?? 1}`);
  
  if (slide.mediaStart !== undefined) {
    parts.push(`${slide.mediaStart}`);
    if (slide.mediaEnd !== undefined) {
      parts.push(`${slide.mediaEnd}`);
    }
  } else if (slide.mediaEnd !== undefined) {
    parts.push(''); // Empty start
    parts.push(`${slide.mediaEnd}`);
  }

  // Trim trailing defaults to keep it short
  // [MEDIA - src - fit - nav - showBg - loop - vol - speed - start - end]
  // Index:
  // 0: [MEDIA
  // 1: src
  // 2: fit (cover)
  // 3: nav (1)
  // 4: showBg (0)
  // 5: loop (1)
  // 6: vol (1)
  // 7: speed (1)
  // 8: start
  // 9: end
  while (parts.length > 2) {
    const last = parts[parts.length - 1];
    if (
      (parts.length === 3 && last === 'cover') ||
      (parts.length === 4 && last === '1') || // nav
      (parts.length === 5 && last === '0') || // showBg
      (parts.length === 6 && last === '1') || // loop
      (parts.length === 7 && last === '1') || // vol
      (parts.length === 8 && last === '1')    // speed
    ) {
      parts.pop();
    } else {
      break;
    }
  }

  return parts.join(' - ') + ']';
};

export const parseMediaSlideString = (text: string): {
  mediaSrc: string;
  fitMode: 'cover' | 'contain' | 'fill';
  presenterNav: boolean;
  showBg: boolean;
  loop: boolean;
  volume: number;
  speed: number;
  startTime?: number;
  endTime?: number
} | null => {
  const clean = text.trim();
  if (!clean.startsWith('[MEDIA')) return null;
  if (!clean.endsWith(']')) return null;

  const inner = clean.substring(clean.indexOf('[') + 6, clean.length - 1).trim();
  if (!inner.startsWith('-')) return null;

  const parts = inner.substring(1).split(' - ').map(p => p.trim());
  if (parts.length < 1) return null;

  // Find the boundary between path and parameters.
  let pathEndIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('"')) {
      pathEndIdx = i;
      break;
    }
  }

  let paramStrings: string[] = [];
  let rawSrc = '';

  if (pathEndIdx !== -1) {
    rawSrc = parts.slice(0, pathEndIdx + 1).join(' - ');
    paramStrings = parts.slice(pathEndIdx + 1);
  } else {
    // Try to find the first parameter that looks like fitMode or a number flag.
    let splitIndex = parts.length;
    for (let i = 1; i < parts.length; i++) {
      if (['cover', 'contain', 'fill'].includes(parts[i]) || !isNaN(parseFloat(parts[i]))) {
        splitIndex = i;
        break;
      }
    }
    rawSrc = parts.slice(0, splitIndex).join(' - ');
    paramStrings = parts.slice(splitIndex);
  }

  if (rawSrc.startsWith('"') && rawSrc.endsWith('"')) {
    rawSrc = rawSrc.substring(1, rawSrc.length - 1);
  }

  const fitModeRaw = paramStrings[0];
  const fitMode = ['cover', 'contain', 'fill'].includes(fitModeRaw) ? (fitModeRaw as 'cover'|'contain'|'fill') : 'cover';
  
  // Offset if fitMode was omitted but other params were provided
  const offset = ['cover', 'contain', 'fill'].includes(fitModeRaw) ? 1 : 0;

  // new order: [MEDIA - src - fit - nav - showBg - loop - vol - speed - start - end]
  const navRaw = paramStrings[offset] ?? '1';
  const bgRaw = paramStrings[offset + 1] ?? '0';
  const loopRaw = paramStrings[offset + 2] ?? '1';
  const volRaw = paramStrings[offset + 3] ?? '1';
  const speedRaw = paramStrings[offset + 4] ?? '1';
  const startRaw = paramStrings[offset + 5] ?? '';
  const endRaw = paramStrings[offset + 6] ?? '';

  const parsedStart = parseFloat(startRaw);
  const parsedEnd = parseFloat(endRaw);

  return {
    mediaSrc: rawSrc,
    fitMode,
    presenterNav: parseFloat(navRaw) !== 0,
    showBg: parseFloat(bgRaw) !== 0,
    loop: parseFloat(loopRaw) !== 0,
    volume: parseFloat(volRaw) || 1,
    speed: parseFloat(speedRaw) || 1,
    startTime: !isNaN(parsedStart) ? parsedStart : undefined,
    endTime: !isNaN(parsedEnd) ? parsedEnd : undefined
  };
};
