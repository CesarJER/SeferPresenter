import React, { useEffect, useRef } from 'react';
import type { LiveAudioRemoteTrack } from '../../../../types/liveAudio';
import { useSmoothVolume } from '../../../../hooks/useSmoothVolume';

interface LiveAudioTrackOutputProps {
  remoteTrack: LiveAudioRemoteTrack;
  volumePercent: number;
}

export const LiveAudioTrackOutput: React.FC<LiveAudioTrackOutputProps> = ({ remoteTrack, volumePercent }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const volume = Math.max(0, Math.min(volumePercent, 100));

  useSmoothVolume(audioRef, volume / 100);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    remoteTrack.attach(audio);
    return () => {
      remoteTrack.detach(audio);
      audio.srcObject = null;
    };
  }, [remoteTrack]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
};
