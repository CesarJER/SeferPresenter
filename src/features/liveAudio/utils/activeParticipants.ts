import type { LiveAudioParticipantStatusMessage } from '../../../types/liveAudio';

type VisibleParticipantSource = Pick<
  LiveAudioParticipantStatusMessage,
  | 'participantId'
  | 'role'
  | 'isActiveAudience'
  | 'isAliasVisibleToActiveParticipants'
  | 'isAliasHiddenByControl'
  | 'isKicked'
>;

export const serializeVisibleParticipants = (participants: string[]) => participants.join('\x00');

export const hasVisibleParticipantsChanged = (
  participants: string[],
  lastSerialized: string,
) => serializeVisibleParticipants(participants) !== lastSerialized;

export const computeVisibleActiveParticipants = (
  participantsMap: Record<string, VisibleParticipantSource>,
  participantAliases: Record<string, string>,
): string[] => (
  Object.values(participantsMap)
    .filter((participant) => (
      participant.role === 'audience' &&
      participant.isActiveAudience === true &&
      participant.isAliasVisibleToActiveParticipants === true &&
      participant.isAliasHiddenByControl !== true &&
      participant.isKicked !== true &&
      Boolean(participantAliases[participant.participantId])
    ))
    .map((participant) => participantAliases[participant.participantId])
    .sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' }))
);
