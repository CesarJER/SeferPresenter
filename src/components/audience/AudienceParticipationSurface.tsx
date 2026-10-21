import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { AudienceLiveAudioContext, type AudienceLiveAudioContextValue } from '../../features/liveAudio/components/audience/AudienceLiveAudioContext';

const RtcAdapter = import.meta.env.VITE_SEFER_LIVE_AUDIO_BUILD !== 'false'
  ? lazy(() => import('../../features/liveAudio/components/audience/LiveAudioAudienceContainer'))
  : null;

class OptionalRtcBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function AudienceParticipationSurface({ children, subscribeToWsMessage }: {
  children: ReactNode;
  subscribeToWsMessage: (handler: (type: string, payload: Record<string, unknown>) => void) => () => void;
}) {
  const [media, setMedia] = useState<AudienceLiveAudioContextValue | null>(null);
  return <AudienceLiveAudioContext.Provider value={media}>
    {children}
    {RtcAdapter && <OptionalRtcBoundary><Suspense fallback={null}>
      <RtcAdapter subscribeToWsMessage={subscribeToWsMessage} onMediaChange={setMedia} />
    </Suspense></OptionalRtcBoundary>}
  </AudienceLiveAudioContext.Provider>;
}
