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
  const isExpired = !code || secondsRemaining <= 0;

  return (
    <div className={`flex items-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      <span className="font-mono font-bold tracking-[0.18em] text-yellow-300 bg-gray-950 border border-yellow-700/60 rounded-sm px-2 py-1 tabular-nums">
        {code ?? '--- ---'}
      </span>
      <span className={`tabular-nums ${isExpired ? 'text-red-300' : 'text-gray-300'}`}>
        {isExpired ? 'caducado' : `${secondsRemaining}s`}
      </span>
    </div>
  );
};
