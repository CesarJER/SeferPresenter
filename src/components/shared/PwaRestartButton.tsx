import { Loader2, RotateCcw, WifiOff } from 'lucide-react';
import { restartPwaApp } from '../../utils/pwaUpdate';
import type { LiveAudioConnectionQuality, LiveAudioConnectionState } from '../../types/liveAudio';

interface PwaRestartButtonProps {
  className?: string;
  connectionState?: LiveAudioConnectionState | null;
  connectionQuality?: LiveAudioConnectionQuality | null;
  controlMenu?: boolean;
}

type WifiBars = 1 | 2 | 3;

const qualityMeta: Record<
  LiveAudioConnectionQuality,
  { bars: WifiBars; toneClassName: string; label: string }
> = {
  excellent: {
    bars: 3,
    toneClassName: 'text-blue-400',
    label: 'Conexión excelente',
  },
  good: {
    bars: 2,
    toneClassName: 'text-green-400',
    label: 'Conexión buena',
  },
  poor: {
    bars: 1,
    toneClassName: 'text-orange-400',
    label: 'Conexión pobre',
  },
  lost: {
    bars: 0 as WifiBars,
    toneClassName: 'text-red-400',
    label: 'Conexión perdida',
  },
  unknown: {
    bars: 3,
    toneClassName: 'text-gray-300',
    label: 'Conexión desconocida',
  },
};

const WifiQualityIcon = ({ bars, className = '' }: { bars: WifiBars | 0; className?: string }) => {
  if (bars === 0) {
    return <WifiOff size={15} className={className} aria-hidden="true" />;
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-[15px] w-[15px] ${className}`}
      aria-hidden="true"
    >
      <path d="M12 20h.01" />
      {bars >= 1 && <path d="M8.5 16.429a5 5 0 0 1 7 0" />}
      {bars >= 2 && <path d="M5 12.859a10 10 0 0 1 14 0" />}
      {bars >= 3 && <path d="M2 8.82a15 15 0 0 1 20 0" />}
    </svg>
  );
};

const getButtonPresentation = (
  connectionState?: LiveAudioConnectionState | null,
  connectionQuality?: LiveAudioConnectionQuality | null,
) => {
  if (connectionState === 'reconnecting') {
    return {
      label: 'Reconectando audio',
      title: 'Reconectando audio. Reiniciar app',
      icon: <Loader2 size={15} className="animate-spin text-orange-400" aria-hidden="true" />,
    };
  }

  if (connectionState === 'connecting') {
    return {
      label: 'Conectando audio',
      title: 'Conectando audio. Reiniciar app',
      icon: <WifiQualityIcon bars={3} className="text-orange-400 animate-pulse" />,
    };
  }

  if (
    connectionState === 'disconnected' ||
    connectionState === 'reconnectFailed' ||
    connectionState === 'permissionDenied' ||
    connectionState === 'unavailable'
  ) {
    return {
      label: 'Audio desconectado',
      title: 'Audio desconectado. Reiniciar app',
      icon: <WifiOff size={15} className="text-red-400" aria-hidden="true" />,
    };
  }

  if (connectionState === 'reconnected') {
    return {
      label: 'Audio reconectado',
      title: 'Audio reconectado. Reiniciar app',
      icon: <WifiQualityIcon bars={3} className="text-emerald-400 animate-pulse" />,
    };
  }

  const quality = connectionQuality ?? 'unknown';
  const meta = qualityMeta[quality];

  return {
    label: meta.label,
    title: `${meta.label}. Reiniciar app`,
    icon: <WifiQualityIcon bars={meta.bars} className={meta.toneClassName} />,
  };
};

export const PwaRestartButton = ({
  className = '',
  connectionState,
  connectionQuality,
  controlMenu = false
}: PwaRestartButtonProps) => {
  const presentation = getButtonPresentation(connectionState, connectionQuality);

  return (
    <button
      type="button"
      onClick={() => {
        void restartPwaApp();
      }}
      className={`group inline-flex items-center justify-center transition-colors border cursor-pointer p-2 ${controlMenu
        ? 'rounded-sm bg-gray-800 border-gray-700 hover:bg-gray-700 text-gray-300 hover:text-white'
        : 'rounded-md  border-white/15 bg-black/45 text-white/75 shadow-lg backdrop-blur-xs  hover:bg-black/65 hover:text-white focus:outline-hidden focus:ring-2 focus:ring-white/60'
        } ${className}`}
      title={presentation.title}
      aria-label={presentation.title}
    >
      <span className="group-hover:hidden flex items-center justify-center" aria-hidden="true" data-testid="connection-indicator">
        {presentation.icon}
      </span>
      <RotateCcw size={14} className="hidden group-hover:block" aria-hidden="true" data-testid="restart-icon" />
      <span className="sr-only">{presentation.label}</span>
    </button>
  );
};
