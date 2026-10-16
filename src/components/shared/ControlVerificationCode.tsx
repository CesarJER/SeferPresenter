import { translate } from '../../i18n/runtime';
import { useUiTranslation } from '../../i18n/useUiTranslation';
import React from 'react';

interface ControlVerificationCodeProps {
  code: string | null;
  secondsRemaining: number;
  compact?: boolean;
}

export const ControlVerificationCode: React.FC<ControlVerificationCodeProps> = ({
  code,
  secondsRemaining,
  compact = false,
}) => {
  useUiTranslation('common');
  const isExpired = !code || secondsRemaining <= 0;

  return (
    <div className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      <span className="font-mono font-bold tracking-[0.18em] text-yellow-300 bg-gray-950 border border-yellow-700/60 rounded-sm px-2 py-1 tabular-nums">
        {code ?? '--- ---'}
      </span>
      <span className={`tabular-nums ${isExpired ? 'text-red-300' : 'text-gray-300'}`}>
        {isExpired ? translate("common:ControlVerificationCode.expired", "caducado") : translate("common:ControlVerificationCode.s", "{{value1}}s", { value1: secondsRemaining })}
      </span>
    </div>
  );
};
