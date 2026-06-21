import type { LiveAudioParticipantStatusMessage } from '../../../types/liveAudio';

export const getAudienceParticipantsNeedingAliasRequest = (
  participantsMap: Record<string, LiveAudioParticipantStatusMessage>,
  participantAliases: Record<string, string>,
): string[] => (
  Object.values(participantsMap)
    .filter((participant) => (
      participant.role === 'audience' &&
      !participant.isKicked &&
      !participantAliases[participant.participantId]
    ))
    .map((participant) => participant.participantId)
    .sort()
);
