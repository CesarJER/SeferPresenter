export const parseVideoSlideString = (text: string): {
  videoSrc: string;
  volume: number;
  speed: number;
  loop: boolean;
  presenterNav: boolean;
  startTime?: number;
  endTime?: number
} | null => {
  const clean = text.trim();
  if (!clean.startsWith('[VIDEO') || !clean.endsWith(']')) return null;

  const inner = clean.substring(6, clean.length - 1).trim();
  if (!inner.startsWith('-')) return null;

  const parts = inner.substring(1).split(' - ').map(p => p.trim());
  if (parts.length < 4) return null;

  // Find the boundary between path and parameters.
  // Case A: The path is quoted. The end of the path is the segment that ends with '"'.
  // Case B: The path is not quoted. Scan from right to left for parameters.
  let pathEndIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].endsWith('"')) {
      pathEndIdx = i;
      break;
    }
  }

  let paramStrings: string[];
  let rawSrc: string;

  if (pathEndIdx !== -1) {
    rawSrc = parts.slice(0, pathEndIdx + 1).join(' - ');
    paramStrings = parts.slice(pathEndIdx + 1);
  } else {
    const splitIndex = parts.length - 6;
    rawSrc = parts.slice(0, splitIndex).join(' - ');
    paramStrings = parts.slice(splitIndex);
  }

  if (rawSrc.startsWith('"') && rawSrc.endsWith('"')) {
    rawSrc = rawSrc.substring(1, rawSrc.length - 1);
  }

  if (!rawSrc) return null;
  if (paramStrings.length < 2) return null;

  const volume = parseFloat(paramStrings[0]);
  const speed = parseFloat(paramStrings[1]);
  if (isNaN(volume) || isNaN(speed)) return null;

  let loop = true;
  let presenterNav = true;
  let startTime: number | undefined;
  let endTime: number | undefined;

  const rawLoop = paramStrings[2];
  if (rawLoop !== '') {
    loop = parseFloat(rawLoop) !== 0;
  }

  const rawPresenterNav = paramStrings[3];
  if (rawPresenterNav !== '') {
    presenterNav = parseFloat(rawPresenterNav) !== 0;
  }
  if (paramStrings.length >= 5) {
    const startStr = paramStrings[4];
    if (startStr !== '') {
      startTime = parseFloat(startStr);
    }
  }
  if (paramStrings.length >= 6) {
    const endStr = paramStrings[5];
    if (endStr !== '') {
      endTime = parseFloat(endStr);
    }
  }

  return {
    videoSrc: rawSrc,
    volume,
    speed,
    loop,
    presenterNav,
    startTime: startTime !== undefined && !isNaN(startTime) ? startTime : undefined,
    endTime: endTime !== undefined && !isNaN(endTime) ? endTime : undefined
  };
};
