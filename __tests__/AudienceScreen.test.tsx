// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import AudienceScreen from '../src/components/audience/AudienceScreen';

// Mock PresenterScreen
vi.mock('../src/components/presenter/PresenterScreen', () => ({
  default: () => <div data-testid="presenter-screen">PresenterScreen</div>
}));

// Mock SeferReaderScreen
vi.mock('../src/components/presenter/SeferReaderScreen', () => ({
  default: () => <div data-testid="sefer-reader-screen">SeferReaderScreen</div>
}));

// Mock QuizAudienceView
vi.mock('../src/components/quiz/QuizAudienceView', () => ({
  QuizAudienceView: () => <div data-testid="quiz-audience-view">QuizAudienceView</div>
}));

// Mock AudienceLiveAudioContext
vi.mock('../src/features/liveAudio/components/audience/AudienceLiveAudioContext', () => ({
  useAudienceLiveAudio: vi.fn(() => ({
    state: 'connected',
    isActive: true,
  }))
}));

// Mock useAudienceAnswers
vi.mock('../src/hooks/useQuizAnswers', () => ({
  useAudienceAnswers: vi.fn(() => ({
    getAnswer: vi.fn(),
    selectRadioOption: vi.fn(),
    toggleCheckboxOption: vi.fn(),
    setCitaField: vi.fn(),
    submitAnswer: vi.fn(),
    clearAnswer: vi.fn(),
    setBonusClaim: vi.fn(),
    getScores: vi.fn(() => ({})),
    saveScore: vi.fn(),
    sendFinalScore: vi.fn(),
  }))
}));

describe('AudienceScreen', () => {
  afterEach(cleanup);
  beforeEach(() => {
    // default location search mock
    Object.defineProperty(window, 'location', {
      value: {
        search: '',
        host: 'localhost:5173'
      },
      writable: true,
    });
  });

  const defaultProps = {
    appMode: 'slides' as const,
    background: 'bg.jpg',
    fontScale: 1,
    presentationTitle: 'Test',
    scriptureState: null,
    slide: null,
    videoState: null,
  };

  it('renders PresenterScreen by default', () => {
    render(<AudienceScreen {...defaultProps} />);
    expect(screen.getByTestId('presenter-screen')).toBeTruthy();
  });

  it('renders QuizAudienceView when quiz is active', () => {
    const slide = { id: 's1', type: 'quiz' as const, label: 'quiz', quizData: { timerSeconds: 30, options: [], question: '', randomize: false, multiSelect: false }, lines: [] };
    render(<AudienceScreen {...defaultProps} slide={slide} quizTimerState={{ status: 'idle', timerStartedAt: null, timerDurationMs: 30000, pausedRemainingMs: null }} />);
    expect(screen.getByTestId('quiz-audience-view')).toBeTruthy();
    expect(screen.queryByTestId('presenter-screen')).toBeNull();
  });

  it('renders PresenterScreen instead of QuizAudienceView when in TV mode', () => {
    window.location.search = '?tv=1';
    const slide = { id: 's1', type: 'quiz' as const, label: 'quiz', quizData: { timerSeconds: 30, options: [], question: '', randomize: false, multiSelect: false }, lines: [] };
    render(<AudienceScreen {...defaultProps} slide={slide} quizTimerState={{ status: 'idle', timerStartedAt: null, timerDurationMs: 30000, pausedRemainingMs: null }} />);
    
    // In TV mode it should skip QuizAudienceView and show PresenterScreen
    expect(screen.queryByTestId('quiz-audience-view')).toBeNull();
    expect(screen.getByTestId('presenter-screen')).toBeTruthy();
    
    // Also it should show the CTA
    expect(screen.getByTestId('tv-cta-banner')).toBeTruthy();
  });

  it('shows CTA in TV mode when displaying SeferReaderScreen', () => {
    window.location.search = '?tv=1';
    const slide = { id: 's1', type: 'quiz' as const, label: 'quiz', quizData: { timerSeconds: 30, options: [], question: '', randomize: false, multiSelect: false }, lines: [] };
    const quizSubslides = [{ kind: 'cita-verse' as const }];
    render(<AudienceScreen {...defaultProps} slide={slide} scriptureState={{ scriptureKind: 'sefer', bookEs: 'Gen', chapter: '1', verse: '1' } as any} quizSubslides={quizSubslides as any} quizCurrentSubslideIndex={0} />);
    
    expect(screen.getByTestId('sefer-reader-screen')).toBeTruthy();
    expect(screen.getByTestId('tv-cta-banner')).toBeTruthy();
  });

  it('does not show CTA when not in TV mode', () => {
    render(<AudienceScreen {...defaultProps} />);
    expect(screen.queryByTestId('tv-cta-banner')).toBeNull();
  });
});
