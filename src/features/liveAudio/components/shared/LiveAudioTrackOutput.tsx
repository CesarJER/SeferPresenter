import React, { useEffect, useRef } from 'react';
import type { LiveAudioRemoteTrack } from '../../../../types/liveAudio';

interface LiveAudioTrackOutputProps {
  remoteTrack: LiveAudioRemoteTrack;
  volumePercent: number;
}

const clampVolume = (value: number) => Math.max(0, Math.min(value, 300));

export const LiveAudioTrackOutput: React.FC<LiveAudioTrackOutputProps> = ({ remoteTrack, volumePercent }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const boostGainRef = useRef<GainNode | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const stream = new MediaStream([remoteTrack.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextConstructor) {
      try {
        const context = new AudioContextConstructor();
        const source = context.createMediaStreamSource(stream);
        const boostGain = context.createGain();
        boostGain.gain.value = 0;
        source.connect(boostGain);
        boostGain.connect(context.destination);
        contextRef.current = context;
        boostGainRef.current = boostGain;

        const resume = () => {
          if (context.state === 'suspended') void context.resume().catch(() => undefined);
        };
        resume();
        window.addEventListener('click', resume, true);
        window.addEventListener('touchstart', resume, true);

        return () => {
          window.removeEventListener('click', resume, true);
          window.removeEventListener('touchstart', resume, true);
          source.disconnect();
          boostGain.disconnect();
          boostGainRef.current = null;
          contextRef.current = null;
          void context.close().catch(() => undefined);
          audio.pause();
          audio.srcObject = null;
        };
      } catch {
        contextRef.current = null;
        boostGainRef.current = null;
      }
    }

    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, [remoteTrack.track]);

  useEffect(() => {
    const volume = clampVolume(volumePercent);
    const audio = audioRef.current;
    if (audio) audio.volume = Math.min(volume, 100) / 100;
    if (boostGainRef.current) boostGainRef.current.gain.value = Math.max(0, volume - 100) / 100;
    if (contextRef.current?.state === 'suspended') void contextRef.current.resume().catch(() => undefined);
  }, [volumePercent]);

  return <audio ref={audioRef} playsInline style={{ display: 'none' }} />;
};
