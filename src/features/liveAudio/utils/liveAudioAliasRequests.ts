import type { LiveAudioParticipantStatusMessage } from '../../../types/liveAudio';

export const getAudienceParticipantsNeedingAliasRequest = (
  participantsMap: Record<string, LiveAudioParticipantStatusMessage>,
  participantAliases: Record<string, string>,
  accessParticipantIds: string[] = [],
): string[] => (
  [...new Set([
    ...accessParticipantIds,
    ...Object.values(participantsMap)
      .filter((participant) => participant.role === 'audience' && !participant.isKicked && participant.isActiveAudience !== false)
      .map((participant) => participant.participantId),
  ])]
    .filter((participantId) => !participantAliases[participantId])
    .sort()
);
