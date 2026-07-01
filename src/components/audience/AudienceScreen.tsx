import { useCallback } from 'react';
import type { AppMode, ScriptureNavState, Slide, VideoState } from '../../types/presentation';
import type { QuizSubslide, QuizTimerState } from '../../types/quiz';
import { useAudienceAnswers } from '../../hooks/useQuizAnswers';
import PresenterScreen from '../presenter/PresenterScreen';
import SeferReaderScreen from '../presenter/SeferReaderScreen';
import { QuizAudienceView } from '../quiz/QuizAudienceView';
import { useAudienceLiveAudio } from '../../features/liveAudio/components/audience/AudienceLiveAudioContext';
import { AudienceLiveAudioPanel } from '../../features/liveAudio/components/audience/AudienceLiveAudioPanel';
import { PwaRestartButton } from '../shared/PwaRestartButton';

interface AudienceScreenProps {
  appMode: AppMode;
  background: string;
  fontScale: number;
  presentationTitle: string;
  scriptureState: ScriptureNavState | null;
  slide: Slide | null;
  videoState: VideoState | null;
  quizSubslides?: QuizSubslide[];
  quizCurrentSubslideIndex?: number;
  quizTimerState?: QuizTimerState;
  quizMaxBaseCentipunts?: number;
}

const AudienceScreen = ({
  appMode,
  background,
  fontScale,
  presentationTitle,
  scriptureState,
  slide,
  videoState,
  quizSubslides = [],
  quizCurrentSubslideIndex = 0,
  quizTimerState,
  quizMaxBaseCentipunts,
}: AudienceScreenProps) => {
  const audienceAnswers = useAudienceAnswers();
  const activeSubslide = quizSubslides[quizCurrentSubslideIndex];
  const isCitaVerse = activeSubslide?.kind === 'cita-verse';

  const liveAudio = useAudienceLiveAudio();

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

  const liveAudioPanel = liveAudio ? (
    <AudienceLiveAudioPanel
      state={liveAudio.state}
      isActive={liveAudio.isActive}
      isMicrophoneActive={liveAudio.isMicrophoneActive}
      hasAudioStarted={liveAudio.hasAudioStarted}
      isPendingWord={liveAudio.isPendingWord}
      isWordGranted={liveAudio.isWordGranted}
      isParticipationBlocked={liveAudio.isParticipationBlocked}
      volume={liveAudio.volume}
      onVolumeChange={liveAudio.onVolumeChange}
      microphoneVolume={liveAudio.microphoneVolume}
      isMusicMode={liveAudio.isMusicMode}
      onMicrophoneVolumeChange={liveAudio.onMicrophoneVolumeChange}
      onMusicModeChange={liveAudio.onMusicModeChange}
      onStartAudio={liveAudio.onStartAudio}
      onRetryAudio={liveAudio.onRetryAudio}
      onJoinActive={liveAudio.onJoinActive}
      onLeaveActive={liveAudio.onLeaveActive}
      onRequestWord={liveAudio.onRequestWord}
      onCancelRequest={liveAudio.onCancelRequest}
      onToggleMicrophone={liveAudio.onToggleMicrophone}
      onOpenMessage={liveAudio.onOpenMessage}
      microphoneDiagnostics={liveAudio.microphoneDiagnostics}
      variant="inline"
    />
  ) : null;

  if (isCitaVerse && scriptureState) {
    return (
      <div className="pointer-events-none h-dvh w-dvw select-none overflow-hidden bg-black">
        <SeferReaderScreen
          scriptureState={scriptureState}
          onVerseSelected={() => {}}
          onLogoClick={handleFullscreen}
          liveAudioPanel={liveAudioPanel}
        />
      </div>
    );
  }

  if (slide?.type === 'quiz' && slide.quizData && quizTimerState && !isCitaVerse) {
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
      <div className="pointer-events-none h-dvh w-dvw select-none overflow-hidden bg-black">
        <SeferReaderScreen
          scriptureState={scriptureState}
          onVerseSelected={() => {}}
          onLogoClick={handleFullscreen}
          liveAudioPanel={liveAudioPanel}
        />
      </div>
    );
  }

  return (
    <div className="pointer-events-none h-dvh w-dvw select-none overflow-hidden bg-black">
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
        liveAudioPanel={liveAudioPanel}
      />
      <div className="fixed bottom-2 left-2 z-50 pointer-events-auto opacity-60 hover:opacity-100 transition-opacity">
        <PwaRestartButton
          connectionState={liveAudio?.state}
          connectionQuality={liveAudio?.connectionQuality}
        />
      </div>
    </div>
  );
};

export default AudienceScreen;
