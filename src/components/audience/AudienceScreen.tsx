import { useCallback, useEffect } from 'react';
import type { AppMode, ScriptureNavState, Slide, VideoState } from '../../types/presentation';
import type { QuizSubslide, QuizTimerState } from '../../types/quiz';
import { useAudienceAnswers } from '../../hooks/useQuizAnswers';
import PresenterScreen from '../presenter/PresenterScreen';
import SeferReaderScreen from '../presenter/SeferReaderScreen';
import { QuizAudienceView } from '../quiz/QuizAudienceView';

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
}: AudienceScreenProps) => {
  const audienceAnswers = useAudienceAnswers();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/audience-sw.js')
      .catch((err) => console.error('Audience service worker registration failed', err));
  }, []);

  const ignorePresenterControl = useCallback(() => {}, []);
  const ignoreVideoState = useCallback(() => {}, []);

  if (slide?.type === 'quiz' && slide.quizData && quizTimerState) {
    const answer = audienceAnswers.getAnswer(slide.id);
    return (
      <div className="h-screen w-screen overflow-hidden bg-black">
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
        />
      </div>
    );
  }

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
        quizSubslides={quizSubslides}
        quizCurrentSubslideIndex={quizCurrentSubslideIndex}
        quizTimerState={quizTimerState}
      />
    </div>
  );
};

export default AudienceScreen;
