import React, { useEffect, useRef } from 'react';
import type { LiveAudioRemoteTrack } from '../../../../types/liveAudio';

interface LiveAudioTrackOutputProps {
  remoteTrack: LiveAudioRemoteTrack;
  volumePercent: number;
}

export const LiveAudioTrackOutput: React.FC<LiveAudioTrackOutputProps> = ({ remoteTrack, volumePercent }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    remoteTrack.attach(audio);
    return () => {
      remoteTrack.detach(audio);
      audio.srcObject = null;
    };
  }, [remoteTrack]);

  useEffect(() => {
    const volume = Math.max(0, Math.min(volumePercent, 100));
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volumePercent]);

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />;
};
