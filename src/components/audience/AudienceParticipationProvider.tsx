import type { ReactNode } from 'react';
import { AudienceParticipationContext, useAudienceParticipationOwner, type AudienceParticipationOptions } from '../../hooks/useAudienceParticipation';

export function AudienceParticipationProvider({ children, ...options }: AudienceParticipationOptions & { children: ReactNode }) {
  const value = useAudienceParticipationOwner(options);
  return <AudienceParticipationContext.Provider value={value}>{children}</AudienceParticipationContext.Provider>;
}
