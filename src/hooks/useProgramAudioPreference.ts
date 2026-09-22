import { useState } from 'react';

export const PROGRAM_AUDIO_KEY = 'sefer.control.programAudioEnabled.v1';

export function useProgramAudioPreference(isMediaMaster: boolean): [boolean, (enabled: boolean) => void] {
  const [preference, setPreference] = useState<boolean | null>(() => {
    const saved = localStorage.getItem(PROGRAM_AUDIO_KEY);
    return saved === null ? null : saved === 'true';
  });

  const setEnabled = (enabled: boolean) => {
    localStorage.setItem(PROGRAM_AUDIO_KEY, String(enabled));
    setPreference(enabled);
  };

  return [preference ?? isMediaMaster, setEnabled];
}
