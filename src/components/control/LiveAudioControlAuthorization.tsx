import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
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
      return translate("control:LiveAudioControlAuthorization.mainControl", "Control principal");
    case 'AUTHORIZED':
      return translate("control:LiveAudioControlAuthorization.authorizedControl", "Control autorizado");
    case 'PENDING':
      return translate("control:LiveAudioControlAuthorization.pendingControl", "Control pendiente");
    default:
      return translate("control:LiveAudioControlAuthorization.connectingControl", "Conectando Control");
  }
};

// getSecondsRemaining removido

export const LiveAudioControlAuthorization: React.FC<LiveAudioControlAuthorizationProps> = ({ authorization }) => {
  useUiTranslation('control');
  const {
    controlState,
    verificationCode,
    secondsRemaining,
    pendingControls,
    canAuthorize,
  } = authorization;
  const isPending = controlState === 'PENDING';
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!canAuthorize || pendingControls.length === 0) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [canAuthorize, pendingControls.length]);

  if (controlState !== 'PENDING') {
    return null;
  }
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
          {translate("control:LiveAudioControlAuthorization.liveAudio", "Live Audio")}</span>
      </div>

      <div className="p-3 space-y-3">
        {isPending && (
          <div className="space-y-2">
            <p className="text-xs text-gray-300">
              {translate("control:LiveAudioControlAuthorization.showThisCodeToTheAuthorizingControl", "Muestra este codigo al Control que autoriza.")}</p>
            <ControlVerificationCode code={verificationCode} secondsRemaining={secondsRemaining} />
          </div>
        )}

      </div>
    </section>
  );
};
