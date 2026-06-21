import React, { useEffect, useRef } from 'react';
import { useLiveAudio } from '../../hooks/useLiveAudio';
import { LiveAudioStatusBadge, type ParticipantStatus } from '../shared/LiveAudioStatusBadge';

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
      {remoteTracks.map((track) => (
        <RemoteAudioTrack key={track.id} track={track} />
      ))}
    </div>
  );
};

const RemoteAudioTrack: React.FC<{ track: MediaStreamTrack }> = ({ track }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      const stream = new MediaStream([track]);
      el.srcObject = stream;
      el.play().catch((err) => {
        console.warn('LiveAudioPresenter: Failed to play remote track:', err);
      });
    }
  }, [track]);

  return <audio ref={audioRef} style={{ display: 'none' }} />;
};

export default LiveAudioPresenter;
