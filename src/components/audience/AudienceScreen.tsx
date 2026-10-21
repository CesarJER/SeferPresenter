import { useCallback, useContext } from 'react';
import type { AppMode, ScriptureNavState, Slide, VideoState } from '../../types/presentation';
import type { QuizSubslide, QuizTimerState } from '../../types/quiz';
import type { AutoduckState } from '../../types/sync';
import { useAudienceAnswers } from '../../hooks/useQuizAnswers';
import PresenterScreen from '../presenter/PresenterScreen';
import SeferReaderScreen from '../presenter/SeferReaderScreen';
import { QuizAudienceView } from '../quiz/QuizAudienceView';
import { useAudienceLiveAudio } from '../../features/liveAudio/components/audience/AudienceLiveAudioContext';
import { AudienceParticipationContext } from '../../hooks/useAudienceParticipation';
import { AudienceParticipationPanel } from './AudienceParticipationPanel';
import { PwaRestartButton } from '../shared/PwaRestartButton';
import AudienceTvCallToAction from './AudienceTvCallToAction';

interface AudienceScreenProps {
  appMode: AppMode;
  background: string;
  fontScale: number;
  presentationTitle: string;
  presentationId: string | null;
  scriptureState: ScriptureNavState | null;
  slide: Slide | null;
  videoState: VideoState | null;
  quizSubslides?: QuizSubslide[];
  quizCurrentSubslideIndex?: number;
  quizTimerState?: QuizTimerState;
  quizMaxBaseCentipunts?: number;
  quizResultSlideIds?: string[];
  quizScoreRequestId?: number;
  autoduckState?: AutoduckState;
  onPlaybackBlocked?: (blocked: boolean) => void;
  serverNow?: () => number;
}

const AudienceScreen = ({
  appMode,
  background,
  fontScale,
  presentationTitle,
  presentationId,
  scriptureState,
  slide,
  videoState,
  quizSubslides = [],
  quizCurrentSubslideIndex = 0,
  quizTimerState,
  quizMaxBaseCentipunts,
  quizResultSlideIds,
  quizScoreRequestId,
  autoduckState,
  onPlaybackBlocked,
  serverNow,
}: AudienceScreenProps) => {
  const audienceAnswers = useAudienceAnswers(presentationId);
  const activeSubslide = quizSubslides[quizCurrentSubslideIndex];
  const isCitaVerse = activeSubslide?.kind === 'cita-verse';

  const isTvMode = new URLSearchParams(window.location.search).get('tv') === '1';
  const domain = import.meta.env.VITE_DOMAIN || window.location.host;

  const liveAudio = useAudienceLiveAudio();
  const participation = useContext(AudienceParticipationContext);

  const handleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen().catch(err => {
        console.warn(`Error attempting to disable fullscreen: ${err.message}`);
      });
    }
  }, []);

  const ignoreVideoState = useCallback(() => {}, []);

  const liveAudioPanel = participation && !isTvMode ? <AudienceParticipationPanel /> : null;
  const needsFallback = !slide || (slide.type === 'quiz' && activeSubslide?.kind === 'results');

  if (isCitaVerse && scriptureState) {
    return (
      <div className="pointer-events-none flex flex-col h-dvh w-dvw select-none overflow-hidden bg-black">
        <div className="flex-1 relative min-h-0">
          <SeferReaderScreen
            interactive={false}
            scriptureState={scriptureState}
            onVerseSelected={() => {}}
            onLogoClick={handleFullscreen}
            liveAudioPanel={liveAudioPanel}
          />
        </div>
        {isTvMode && <AudienceTvCallToAction domain={domain} />}
      </div>
    );
  }

  if (slide?.type === 'quiz' && slide.quizData && quizTimerState && !isCitaVerse && !isTvMode) {
    const answer = audienceAnswers.getAnswer(slide.id);
    return (
      <div className="h-dvh w-dvw overflow-hidden bg-black">
        <QuizAudienceView
          slide={slide}
          quizData={slide.quizData}
          subslides={quizSubslides}
          currentSubslideIndex={quizCurrentSubslideIndex}
          timerState={quizTimerState}
          answer={answer}
          onSelectRadio={(optionId) => audienceAnswers.selectRadioOption(slide.id, optionId)}
          onToggleCheckbox={(optionId) => audienceAnswers.toggleCheckboxOption(slide.id, optionId)}
          onSetCitaField={(fields) => audienceAnswers.setCitaField(slide.id, fields)}
          onSubmit={() => audienceAnswers.submitAnswer(slide.id)}
          onClear={() => audienceAnswers.clearAnswer(slide.id)}
          onBonusClaim={(claimed) => audienceAnswers.setBonusClaim(slide.id, claimed)}
          savedScore={audienceAnswers.getScores()[slide.id]}
          allScores={audienceAnswers.getScores()}
          resultSlideIds={quizResultSlideIds}
          scoreRequestId={quizScoreRequestId}
          onSaveScore={(score) => audienceAnswers.saveScore(slide.id, score)}
          onSendFinalScore={audienceAnswers.sendFinalScore}
          maxBaseCentipunts={quizMaxBaseCentipunts}
          liveAudioPanel={liveAudioPanel}
        />
      </div>
    );
  }

  if ((appMode === 'seferManual' || (appMode === 'scripture' && scriptureState?.scriptureKind !== 'tanaj')) && scriptureState) {
    return (
      <div className="pointer-events-none flex flex-col h-dvh w-dvw select-none overflow-hidden bg-black">
        <div className="flex-1 relative min-h-0">
          <SeferReaderScreen
            interactive={false}
            scriptureState={scriptureState}
            onVerseSelected={() => {}}
            onLogoClick={handleFullscreen}
            liveAudioPanel={liveAudioPanel}
          />
        </div>
        {isTvMode && <AudienceTvCallToAction domain={domain} />}
      </div>
    );
  }

  return (
    <div className="pointer-events-none flex flex-col h-dvh w-dvw select-none overflow-hidden bg-black">
      <div className="flex-1 relative min-h-0">
        <PresenterScreen
          background={background}
          slide={slide}
          presentationTitle={presentationTitle}
          fontScale={fontScale}
          onLogoClick={handleFullscreen}
          videoState={videoState}
          onVideoStateChange={ignoreVideoState}
          quizSubslides={quizSubslides}
          quizCurrentSubslideIndex={quizCurrentSubslideIndex}
          quizTimerState={quizTimerState}
          liveAudioPanel={needsFallback ? null : liveAudioPanel}
          autoduckState={autoduckState}
          onPlaybackBlocked={onPlaybackBlocked}
          enableDriftCorrection={true}
          serverNow={serverNow}
        />
      </div>
      {needsFallback && liveAudioPanel && <div className="fixed bottom-12 start-0 end-0 z-60 pointer-events-auto">{liveAudioPanel}</div>}
      <div className="fixed bottom-2 start-2 z-50 pointer-events-auto opacity-60 hover:opacity-100 transition-opacity">
        <PwaRestartButton
          connectionState={liveAudio?.state}
          connectionQuality={liveAudio?.connectionQuality}
        />
      </div>
      {isTvMode && <AudienceTvCallToAction domain={domain} />}
    </div>
  );
};

export default AudienceScreen;
