import { createContext, useContext } from 'react';
import type { useLiveAudio } from './useLiveAudio';

export type LiveAudioContextValue = ReturnType<typeof useLiveAudio>;

export const LiveAudioContext = createContext<LiveAudioContextValue | null>(null);

export const useLiveAudioContext = () => {
  const value = useContext(LiveAudioContext);
  if (!value) throw new Error('useLiveAudioContext must be used inside LiveAudioProvider');
  return value;
};
