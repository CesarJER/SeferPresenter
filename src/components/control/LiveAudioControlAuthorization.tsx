import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, ShieldQuestion, X } from 'lucide-react';
import type { ControlAuthorizationState } from '../../hooks/useControlAuthorization';
import { ControlVerificationCode } from '../shared/ControlVerificationCode';

interface LiveAudioControlAuthorizationProps {
  authorization: ControlAuthorizationState;
}

const getStateLabel = (state: ControlAuthorizationState['controlState']) => {
  switch (state) {
    case 'PRINCIPAL':
      return 'Control principal';
    case 'AUTHORIZED':
      return 'Control autorizado';
    case 'PENDING':
      return 'Control pendiente';
    default:
      return 'Conectando Control';
  }
};

const getSecondsRemaining = (expiresAt: number): number =>
  Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

export const LiveAudioControlAuthorization: React.FC<LiveAudioControlAuthorizationProps> = ({ authorization }) => {
  const {
    controlState,
    verificationCode,
    secondsRemaining,
    pendingControls,
    canAuthorize,
    approveControl,
    rejectControl,
  } = authorization;
  const isPending = controlState === 'PENDING';
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!canAuthorize || pendingControls.length === 0) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [canAuthorize, pendingControls.length]);

  return (
    <section className="rounded-md border border-gray-700 bg-gray-900/95 shadow-lg text-gray-100 w-[min(28rem,calc(100vw-1rem))]">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {controlState === 'PENDING' ? (
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

        {canAuthorize && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                Controles pendientes
              </h3>
              <span className="text-[11px] text-gray-500 tabular-nums">
                {pendingControls.length}
              </span>
            </div>

            {pendingControls.length === 0 ? (
              <p className="text-xs text-gray-500">Sin solicitudes pendientes.</p>
            ) : (
              <div className="space-y-2">
                {pendingControls.map((pending) => {
                  const remaining = getSecondsRemaining(pending.codeExpiresAt);
                  const expired = remaining <= 0;

                  return (
                    <div
                      key={pending.controlSessionId}
                      className="rounded border border-gray-800 bg-gray-950/70 p-2 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <ControlVerificationCode
                          code={pending.verificationCode}
                          secondsRemaining={remaining}
                          compact
                        />
                        <span className="text-[10px] text-gray-500 font-mono truncate">
                          {pending.controlSessionId.slice(0, 18)}
                        </span>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => rejectControl(pending.controlSessionId)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded border border-red-900/70 bg-red-950/70 text-red-200 hover:bg-red-900/80 disabled:opacity-40"
                          disabled={expired}
                          title="Rechazar Control"
                        >
                          <X size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => approveControl(pending.controlSessionId)}
                          className="h-8 w-8 inline-flex items-center justify-center rounded border border-emerald-800/70 bg-emerald-950/70 text-emerald-200 hover:bg-emerald-900/80 disabled:opacity-40"
                          disabled={expired}
                          title="Autorizar Control"
                        >
                          <Check size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
