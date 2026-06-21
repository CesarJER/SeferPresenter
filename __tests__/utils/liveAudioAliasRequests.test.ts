import { describe, expect, it } from 'vitest';
import { getAudienceParticipantsNeedingAliasRequest } from '../../src/features/liveAudio/utils/liveAudioAliasRequests';

describe('live audio alias request targets', () => {
  it('returns unresolved audience participants in a stable order', () => {
    const participants = {
      b: {
        type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
        participantId: 'b',
        role: 'audience',
        speakerState: 'LISTENER',
        canSubscribe: true,
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        isKicked: false,
      },
      a: {
        type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
        participantId: 'a',
        role: 'audience',
        speakerState: 'LISTENER',
        canSubscribe: true,
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        isKicked: false,
      },
      kicked: {
        type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
        participantId: 'kicked',
        role: 'audience',
        speakerState: 'REVOKED',
        canSubscribe: true,
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: false,
        isMicrophoneActive: false,
        isKicked: true,
      },
      control: {
        type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
        participantId: 'control',
        role: 'control',
        speakerState: 'LISTENER',
        canSubscribe: true,
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: false,
        isMicrophoneActive: false,
        isKicked: false,
      },
    };

    const aliases = {
      b: 'Beatriz',
    };

    expect(getAudienceParticipantsNeedingAliasRequest(participants, aliases)).toEqual(['a']);
  });

  it('returns an empty list when every audience participant already has a nick', () => {
    const participants = {
      a: {
        type: 'LIVE_AUDIO_PARTICIPANT_STATUS',
        participantId: 'a',
        role: 'audience',
        speakerState: 'LISTENER',
        canSubscribe: true,
        canPublishAudio: false,
        isMuted: true,
        isActiveAudience: true,
        isMicrophoneActive: false,
        isKicked: false,
      },
    };

    expect(getAudienceParticipantsNeedingAliasRequest(participants, { a: 'Alberto' })).toEqual([]);
  });
});
