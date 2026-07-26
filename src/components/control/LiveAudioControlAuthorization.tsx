import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldQuestion } from 'lucide-react';
import type { ControlAuthorizationState } from '../../hooks/useControlAuthorization';
import { ControlVerificationCode } from '../shared/ControlVerificationCode';
// Hook removido

interface LiveAudioControlAuthorizationProps {
  authorization: ControlAuthorizationState;
}

const getStateLabel = (state: ControlAuthorizationState['controlState']) => {
  switch (state) {
    case 'PRINCIPAL':
      return 'Control principal';
    case 'AUTHORIZED':
      return 'Control autorizado';
    case 'AUTHORIZED_SYNCING':
      return 'Control autorizado, sincronizando';
    case 'PENDING':
      return 'Control pendiente';
    default:
      return 'Conectando Control';
  }
};

// getSecondsRemaining removido

export const LiveAudioControlAuthorization: React.FC<LiveAudioControlAuthorizationProps> = ({ authorization }) => {
  const {
    controlState,
    verificationCode,
    secondsRemaining,
    pendingControls,
    canAuthorize,
  } = authorization;
  const isPending = controlState === 'PENDING';
  const isSyncing = controlState === 'AUTHORIZED_SYNCING';
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!canAuthorize || pendingControls.length === 0) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [canAuthorize, pendingControls.length]);

  if (!isPending && !isSyncing) {
    return null;
  }
  return (
    <section className="rounded-md border border-gray-700 bg-gray-900/95 shadow-lg text-gray-100 w-[min(28rem,calc(100vw-1rem))]">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {isPending ? (
            <ShieldQuestion size={16} className="text-yellow-300 flex-none" />
          ) : (
            <ShieldCheck size={16} className="text-emerald-300 flex-none" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide truncate">
            {getStateLabel(controlState)}
          </span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono truncate">
          Live Audio
        </span>
      </div>

      <div className="p-3 space-y-3">
        {isPending && (
          <div className="space-y-2">
            <p className="text-xs text-gray-300">
              Muestra este codigo al Control que autoriza.
            </p>
            <ControlVerificationCode code={verificationCode} secondsRemaining={secondsRemaining} />
          </div>
        )}
        {isSyncing && (
          <p role="status" aria-live="polite" className="text-xs text-blue-200">
            Sincronizando la clave privada de Control. Las acciones de moderación permanecen bloqueadas.
          </p>
        )}

      </div>
    </section>
  );
};
