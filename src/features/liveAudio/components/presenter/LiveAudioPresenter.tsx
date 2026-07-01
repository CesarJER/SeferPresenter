import React, { useEffect } from 'react';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { PwaRestartButton } from '../../../../components/shared/PwaRestartButton';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';

const LiveAudioPresenter: React.FC = () => {
  const { availability, state, connectionQuality, remoteTracks, startRemoteAudio } = useLiveAudio({
    role: 'presenter',
    autoConnect: true,
  });

  useEffect(() => {
    if (state === 'connected') {
      startRemoteAudio().catch((err) => {
        console.warn('LiveAudioPresenter: Failed to start remote audio (user interaction might be required):', err);
      });
    }
  }, [state, startRemoteAudio]);

  const connectionState = availability === 'enabled' ? state : undefined;
  const signalQuality = availability === 'enabled' ? connectionQuality : undefined;

  return (
    <div className="absolute bottom-[2vh] left-[2vw] z-50 pointer-events-none opacity-40">
      <div className="pointer-events-auto">
        <PwaRestartButton connectionState={connectionState} connectionQuality={signalQuality} />
      </div>
      {remoteTracks.map((remoteTrack) => (
        <LiveAudioTrackOutput key={remoteTrack.id} remoteTrack={remoteTrack} volumePercent={100} />
      ))}
    </div>
  );
};

export default LiveAudioPresenter;
