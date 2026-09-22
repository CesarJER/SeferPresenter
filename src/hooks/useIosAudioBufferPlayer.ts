import { useEffect, useState } from 'react';
import type { AutoduckState } from '../types/sync';
import { IosAudioBufferPlayer } from '../utils/iosAudioBufferPlayer';
import { isIphoneDevice } from '../utils/mediaVolume';

const clamp01 = (value: number) => Math.max(0, Math.min(value, 1));

export function useIosAudioBufferPlayer(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  baseVolume: number,
  autoduckState?: AutoduckState,
  enabled: boolean = true,
  outputEnabled: boolean = true,
): { isIos: boolean; player: IosAudioBufferPlayer | null } {
  const [isIos] = useState(() => enabled && isIphoneDevice());
  const [isDucking, setIsDucking] = useState(false);
  const [player, setPlayer] = useState<IosAudioBufferPlayer | null>(null);

  useEffect(() => {
    if (!isIos) return;
    try {
      const nextPlayer = new IosAudioBufferPlayer();
      setPlayer(nextPlayer);
      return () => {
        nextPlayer.destroy();
      };
    } catch {
      setPlayer(null);
    }
  }, [isIos]);

  useEffect(() => {
    if (!player) return;
    player.setFallbackElement(audioRef.current);
    return () => player.setFallbackElement(null);
  }, [audioRef, player]);

  useEffect(() => {
    if (!isIos) return;
    const handleAutoduck = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean; isDuckingActive?: boolean }>).detail;
      setIsDucking(detail?.active ?? detail?.isDuckingActive ?? false);
    };
    window.addEventListener('sefer-autoduck', handleAutoduck);
    return () => window.removeEventListener('sefer-autoduck', handleAutoduck);
  }, [isIos]);

  useEffect(() => {
    if (!player) return;
    const safeVolume = Number.isFinite(baseVolume) ? clamp01(baseVolume) : 1;
    const rawFactor = autoduckState?.factor ?? 0.2;
    const factor = Number.isFinite(rawFactor) ? clamp01(rawFactor) : 0.2;
    player.setVolume(outputEnabled ? (autoduckState?.enabled && isDucking ? safeVolume * factor : safeVolume) : 0, outputEnabled ? 300 : 0);
  }, [baseVolume, autoduckState?.enabled, autoduckState?.factor, isDucking, player, outputEnabled]);

  return { isIos, player };
}
