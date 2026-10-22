export const conversationIdFor = (sessionId: string, participantId: string) => JSON.stringify([sessionId, participantId]);

export const isConversationOperationId = (id: unknown): id is string => typeof id === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
