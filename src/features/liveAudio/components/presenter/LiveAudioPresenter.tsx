import React, { useEffect } from 'react';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { LiveAudioStatusBadge, type ParticipantStatus } from '../shared/LiveAudioStatusBadge';
import { LiveAudioTrackOutput } from '../shared/LiveAudioTrackOutput';

const LiveAudioPresenter: React.FC = () => {
  const { availability, state, remoteTracks, startRemoteAudio } = useLiveAudio({
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

  if (availability !== 'enabled') {
    return null;
  }

  const badgeStatus: ParticipantStatus =
    state === 'connected' ? 'connected' :
    state === 'reconnected' ? 'reconnected' :
    state === 'reconnectFailed' ? 'reconnect-failed' :
    (state === 'connecting' || state === 'reconnecting') ? 'reconnecting' : 'disconnected';

  return (
    <div className="absolute bottom-[2vh] left-[2vw] z-50 pointer-events-none opacity-40">
      <LiveAudioStatusBadge status={badgeStatus} isMuted={true} />
      {remoteTracks.map((remoteTrack) => (
        <LiveAudioTrackOutput key={remoteTrack.id} remoteTrack={remoteTrack} volumePercent={100} />
      ))}
    </div>
  );
};

export default LiveAudioPresenter;
