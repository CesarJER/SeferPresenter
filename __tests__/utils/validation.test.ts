import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_STATE } from '../../src/types/audio';
import { sanitizeSlideHtml } from '../../src/utils/hebrewText';
import {
  isValidEphemeralParticipantId,
  isValidControlVerificationCode,
  isValidPrivateControlSignal,
  validateAudioSyncMaps,
  validatePresentationList,
  validateSyncMessage,
} from '../../src/utils/validation';

const validPresentation = {
  id: 'p1',
  title: 'Servicio',
  background: '/backgrounds/bg.png',
  mode: 'trilingual',
  customField: 'preserved',
  slides: [
    {
      id: 's1',
      label: '1',
      lines: ['<span>Texto</span>', 'Trans', 'Trad'],
      type: 'sefer',
      scriptureBook: 'Gn',
      scriptureChapter: '1',
      scriptureVerseStart: '1',
      scriptureVerseEnd: '3',
    },
  ],
};

const validAudioMap = {
  id: 'a1',
  name: 'Lectura',
  audioSrc: '/audio/lectura.mp3',
  presentationId: 'p1',
  defaultSyncMode: 'unilateral',
  defaultVolume: 0.7,
  cues: [
    { timeSec: 0, slideIndex: 0 },
    { timeSec: 3.5, slideIndex: 0, verse: '2' },
  ],
};

describe('runtime validation', () => {
  it('accepts valid presentations and preserves safe unknown fields', () => {
    const result = validatePresentationList([validPresentation]);

    expect(result.ok).toBe(true);
    expect(result.value?.[0].slides[0].type).toBe('sefer');
    expect((result.value?.[0] as typeof validPresentation | undefined)?.customField).toBe('preserved');
  });

  it('rejects malformed presentation and slide payloads', () => {
    const result = validatePresentationList([
      { ...validPresentation, slides: [{ id: 's1', label: '1', lines: [1] }] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('lines');
  });

  it('accepts quiz result slides without answer options', () => {
    const result = validatePresentationList([
      {
        ...validPresentation,
        slides: [
          {
            id: 'r1',
            label: 'Resultados',
            lines: ['R1: Excelente /// Alto /// Texto', '-', '-'],
            type: 'quiz',
            quizData: {
              question: 'Resultados',
              options: [],
              timerSeconds: 30,
              randomize: false,
              multiSelect: false,
              isResultsSlide: true,
              resultProfiles: [
                { rank: 1, title: 'Excelente', description: 'Alto', giftText: 'Texto' },
              ],
            },
          },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it('still rejects normal quiz slides with fewer than two options', () => {
    const result = validatePresentationList([
      {
        ...validPresentation,
        slides: [
          {
            id: 'q1',
            label: 'Pregunta',
            lines: ['P: Pregunta [30, 0, 0]', '-', '-'],
            type: 'quiz',
            quizData: {
              question: 'Pregunta',
              options: [{ id: 'A', text: 'Uno', isCorrect: true }],
              timerSeconds: 30,
              randomize: false,
              multiSelect: false,
            },
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('entre 2 y 4 opciones');
  });

  it('accepts valid audio sync maps and rejects bad cues', () => {
    expect(validateAudioSyncMaps([validAudioMap]).ok).toBe(true);

    const result = validateAudioSyncMaps([
      { ...validAudioMap, cues: [{ timeSec: -1, slideIndex: 0 }] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('timeSec');
  });

  it('validates timeline track defaults for volume and sync mode', () => {
    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: {
        type: 'SET_TRACK',
        presentationId: 'p1',
        audioSrc: '/audio/lectura.mp3',
        syncMapId: 'a1',
        syncMode: 'unilateral',
        volume: 0.7,
      },
    }).ok).toBe(true);

    const result = validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: {
        type: 'SET_TRACK',
        presentationId: 'p1',
        audioSrc: '/audio/lectura.mp3',
        syncMode: 'bilateral',
        volume: 1.5,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('volume');
  });

  it('rejects malformed media, scripture and quiz result fields', () => {
    const invalidPresentation = {
      ...validPresentation,
      slides: [{
        id: 's1',
        label: '1',
        lines: ['Texto'],
        mediaFit: 'stretch',
        scriptureVerses: [['valid'], [1]],
        type: 'quiz',
        quizData: {
          question: 'Resultados',
          options: [],
          timerSeconds: 30,
          randomize: false,
          multiSelect: false,
          isResultsSlide: true,
          resultProfiles: [{ rank: 1, title: 'Titulo' }],
        },
      }],
    };

    const result = validatePresentationList([invalidPresentation]);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('mediaFit');
    expect(result.errors.join('\n')).toContain('scriptureVerses');
    expect(result.errors.join('\n')).toContain('description');
    expect(result.errors.join('\n')).toContain('giftText');
  });

  it('deeply validates synchronized quiz state', () => {
    const baseMessage = {
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
      backgroundLock: false,
      lockedBackgroundValue: null,
      userSelectedBackground: null,
      videoState: null,
      appMode: 'slides',
      scriptureState: null,
      audioState: DEFAULT_AUDIO_STATE,
    };

    expect(validateSyncMessage({ ...baseMessage, quizState: {} }).ok).toBe(false);
    expect(validateSyncMessage({
      ...baseMessage,
      quizState: {
        currentSubslideIndex: 0,
        timerState: {
          status: 'running',
          timerStartedAt: Date.now(),
          timerDurationMs: 30_000,
          pausedRemainingMs: null,
        },
        presenterDemoSelection: { q1: 'A' },
        feedbackSound: { type: 'bip', timestamp: Date.now() },
      },
    }).ok).toBe(true);
    expect(validateSyncMessage({
      ...baseMessage,
      quizState: {
        currentSubslideIndex: -1,
        timerState: {
          status: 'invalid',
          timerStartedAt: null,
          timerDurationMs: -1,
          pausedRemainingMs: null,
        },
        presenterDemoSelection: { q1: 'Z' },
      },
    }).ok).toBe(false);
  });

  it('validates timeline duration, loop, and end actions', () => {
    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: { type: 'SET_DURATION', durationSec: 120 },
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: { type: 'SET_LOOP', loop: true },
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: { type: 'END', positionSec: 120 },
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: { type: 'SET_DURATION', durationSec: -1 },
    }).ok).toBe(false);

    expect(validateSyncMessage({
      type: 'AUDIO_TIMELINE_ACTION',
      action: { type: 'SET_LOOP', loop: 'yes' },
    }).ok).toBe(false);
  });

  it('rejects incomplete sync state messages', () => {
    const result = validateSyncMessage({
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('audioState');
  });

  it('accepts complete sync state messages', () => {
    const result = validateSyncMessage({
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
      backgroundLock: false,
      lockedBackgroundValue: null,
      userSelectedBackground: null,
      videoState: null,
      appMode: 'slides',
      scriptureState: null,
      audioState: DEFAULT_AUDIO_STATE,
    });

    expect(result.ok).toBe(true);
  });

  it('validates autoduck state in sync and remote command messages', () => {
    expect(validateSyncMessage({
      type: 'SYNC_STATE',
      clientId: 'c1',
      origin: 'control',
      presentation: validPresentation,
      slideIndex: 0,
      backgroundLock: false,
      lockedBackgroundValue: null,
      userSelectedBackground: null,
      videoState: null,
      appMode: 'slides',
      scriptureState: null,
      audioState: DEFAULT_AUDIO_STATE,
      autoduckState: { enabled: true, factor: 0.35 },
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'c1',
      payload: {
        command: 'SET_AUTODUCK_STATE',
        state: { enabled: true, factor: 0.35 },
      },
    }).ok).toBe(true);

    const result = validateSyncMessage({
      type: 'REMOTE_COMMAND',
      clientId: 'c1',
      payload: {
        command: 'SET_AUTODUCK_STATE',
        state: { enabled: true, factor: 2 },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('factor');
  });

  it('accepts valid private control signals as separate Live Audio messages', () => {
    const result = validateSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      toControlSessionId: 'control-session-1',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
      createdAt: 123,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts valid control-to-audience private control signals', () => {
    expect(validateSyncMessage({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: 'control-session-1',
      toParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
      createdAt: 123,
    }).ok).toBe(true);

    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: 'control-session-1',
      toParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
    }, 'control')).toBe(true);
  });

  it('accepts empty live audio alias requests', () => {
    expect(validateSyncMessage({
      type: 'LIVE_AUDIO_REQUEST_ALIASES',
      createdAt: Date.now(),
    }).ok).toBe(true);
  });

  it('validates ephemeral participant IDs as UUID v4 only', () => {
    expect(isValidEphemeralParticipantId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isValidEphemeralParticipantId('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
    expect(isValidEphemeralParticipantId('not-a-uuid')).toBe(false);
  });

  it('validates short control verification codes', () => {
    expect(isValidControlVerificationCode('123-456')).toBe(true);
    expect(isValidControlVerificationCode('123456')).toBe(false);
    expect(isValidControlVerificationCode('12A-456')).toBe(false);
  });

  it('accepts control authorization state and decision messages', () => {
    expect(validateSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_STATE',
      controlSessionId: 'control-1',
      controlState: 'PRINCIPAL',
      allowDelegatedModerators: true,
      pendingControls: [
        {
          controlSessionId: 'control-2',
          verificationCode: '123-456',
          codeExpiresAt: Date.now() + 90_000,
          connectedAt: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'LIVE_AUDIO_CONTROL_AUTHORIZATION_DECISION',
      targetControlSessionId: 'control-2',
      decision: 'APPROVE',
      issuedByControlSessionId: 'control-1',
      createdAt: Date.now(),
    }).ok).toBe(true);
  });

  it('accepts operational snapshot and rescue messages', () => {
    const participantId = '550e8400-e29b-41d4-a716-446655440000';
    expect(validateSyncMessage({
      type: 'LIVE_AUDIO_RESCUE_PARTICIPANT',
      participantId,
      createdAt: Date.now(),
    }).ok).toBe(true);

    expect(validateSyncMessage({
      type: 'LIVE_AUDIO_SNAPSHOT',
      snapshot: {
        snapshotId: 'snapshot-1',
        createdAt: Date.now(),
        connectionCounts: {
          totalConnections: 1,
          audienceConnections: 1,
          controlConnections: 0,
          presenterConnections: 0,
          updatedAt: Date.now(),
        },
        participants: [{
          participantId,
          role: 'audience',
          alias: 'Temporal',
          operationalRole: 'activo',
          microphonePermissionState: 'unknown',
          microphoneTrackState: 'off',
          speakerState: 'LISTENER',
          canSubscribe: true,
          canPublishAudio: false,
          isMuted: true,
          isActiveAudience: true,
          isMicrophoneActive: false,
          isKicked: false,
          connected: true,
          updatedAt: Date.now(),
        }],
        interventionQueue: [],
        authorizations: {
          principalControlSessionId: 'control-1',
          controls: [{
            controlSessionId: 'control-1',
            clientId: 'client-1',
            controlState: 'PRINCIPAL',
            connectedAt: Date.now(),
            authorizedAt: Date.now(),
          }],
          pendingControls: [],
          allowDelegatedModerators: true,
        },
        liveKit: {
          enabled: true,
          available: true,
          participants: [],
          speakers: [],
          muted: [],
          kicked: [],
        },
        quizAggregate: {
          submittedAnswersBySlideId: { slide1: 2 },
          finalScoreRanges: { '0-99': 1 },
          totalFinalScores: 1,
          minimumGroupSize: 3,
          updatedAt: Date.now(),
        },
      },
      createdAt: Date.now(),
    }).ok).toBe(true);
  });

  it('rejects malformed private control signals', () => {
    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: 'not-a-uuid',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
    })).toBe(false);

    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'not base64',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
    })).toBe(false);

    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
      consentGiven: true,
    })).toBe(false);
  });

  it('rejects malformed role-specific private control signals or oversized ciphertext', () => {
    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
    }, 'control')).toBe(false);

    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      toParticipantId: '550e8400-e29b-41d4-a716-446655440001',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'SGVsbG8=',
      nonce: 'AQIDBAUGBwgJCgsM',
    }, 'audience')).toBe(false);

    expect(isValidPrivateControlSignal({
      type: 'PRIVATE_CONTROL_SIGNAL',
      fromParticipantId: '550e8400-e29b-41d4-a716-446655440000',
      keyId: 'key-1',
      ephemeralPublicKey: 'AQIDBA==',
      ciphertext: 'A'.repeat(5464),
      nonce: 'AQIDBAUGBwgJCgsM',
    }, 'audience')).toBe(false);
  });
});

describe('slide HTML sanitizing', () => {
  it('keeps allowed formatting and removes unsafe markup', () => {
    const clean = sanitizeSlideHtml('<span class="hebrew" onclick="bad()">Shalom</span><br><script>bad()</script><img src=x>');

    expect(clean).toContain('<span class="hebrew">Shalom</span>');
    expect(clean).toMatch(/<br\s*\/?>/);
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('<img');
  });
});
