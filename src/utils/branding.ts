import type { SyntheticEvent } from 'react';
import neutralLogoUrl from '../assets/branding/logo.svg';

export const applyNeutralBrandingFallback = (
  event: SyntheticEvent<HTMLImageElement>,
) => {
  const image = event.currentTarget;
  if (image.getAttribute('src') === neutralLogoUrl) return;
  image.src = neutralLogoUrl;
};
