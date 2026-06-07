import { useCallback, useEffect } from 'react';
import type { AppMode, ScriptureNavState, Slide, VideoState } from '../../types/presentation';
import PresenterScreen from '../presenter/PresenterScreen';
import SeferReaderScreen from '../presenter/SeferReaderScreen';

interface AudienceScreenProps {
  appMode: AppMode;
  background: string;
  fontScale: number;
  presentationTitle: string;
  scriptureState: ScriptureNavState | null;
  slide: Slide | null;
  videoState: VideoState | null;
}

const AudienceScreen = ({
  appMode,
  background,
  fontScale,
  presentationTitle,
  scriptureState,
  slide,
  videoState,
}: AudienceScreenProps) => {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/audience-sw.js')
      .catch((err) => console.error('Audience service worker registration failed', err));
  }, []);

  const ignorePresenterControl = useCallback(() => {}, []);
  const ignoreVideoState = useCallback(() => {}, []);

  if ((appMode === 'seferManual' || (appMode === 'scripture' && scriptureState?.scriptureKind !== 'tanaj')) && scriptureState) {
    return (
      <div className="pointer-events-none h-screen w-screen select-none overflow-hidden bg-black">
        <SeferReaderScreen
          scriptureState={scriptureState}
          onVerseSelected={ignorePresenterControl}
          onLogoClick={ignorePresenterControl}
        />
      </div>
    );
  }

  return (
    <div className="pointer-events-none h-screen w-screen select-none overflow-hidden bg-black">
      <PresenterScreen
        background={background}
        slide={slide}
        presentationTitle={presentationTitle}
        fontScale={fontScale}
        onLogoClick={ignorePresenterControl}
        videoState={videoState}
        onVideoStateChange={ignoreVideoState}
      />
    </div>
  );
};

export default AudienceScreen;
