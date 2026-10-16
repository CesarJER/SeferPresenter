import { translate } from '../../../../i18n/runtime';
import { useUiTranslation } from '../../../../i18n/useUiTranslation';
import React from 'react';
import { Mic, MicOff, Hand, Wifi, WifiOff, Loader2, RotateCcw, CheckCircle2, XCircle } from 'lucide-react';
export type ParticipantStatus =
  | 'microphone-published'
  | 'publishing'
  | 'microphone-error'
  | 'permission-granted'
  | 'permission-requested'
  | 'kicked'
  | 'connected'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnect-failed'
  | 'disconnected';

interface LiveAudioStatusBadgeProps {
  status: ParticipantStatus;
  isMuted: boolean;
  className?: string;
}

export const LiveAudioStatusBadge: React.FC<LiveAudioStatusBadgeProps> = ({ status, isMuted, className = '' }) => {
  useUiTranslation('liveAudio');
  if (status === 'microphone-published') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-blue-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.microphonePublished", "Micrófono publicado")}>
        <Mic size={16} className="text-blue-400" />
      </div>
    );
  }

  if (status === 'publishing') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-orange-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.publishingMicrophone", "Publicando micrófono")}>
        <Loader2 size={16} className="text-orange-400 animate-spin" />
      </div>
    );
  }

  if (status === 'microphone-error') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-red-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.errorPublishingMicrophone", "Error al publicar el micrófono")}>
        <XCircle size={16} className="text-red-400" />
      </div>
    );
  }

  if (status === 'permission-granted') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-gray-500/20 p-1.5 ${className}`} title={isMuted ? translate("liveAudio:LiveAudioStatusBadge.microphoneOff", "Micrófono apagado") : translate("liveAudio:LiveAudioStatusBadge.microphoneAvailable", "Micrófono disponible")}>
        {isMuted ? <MicOff size={16} className="text-gray-400" /> : <Mic size={16} className="text-gray-400" />}
      </div>
    );
  }

  if (status === 'permission-requested') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-yellow-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.handRaised", "Mano levantada")}>
        <Hand size={16} className="text-yellow-400" />
      </div>
    );
  }

  if (status === 'kicked') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-red-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.restrictedVoiceBlocked", "Restringido (Voz bloqueada)")}>
        <XCircle size={16} className="text-red-400" />
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-green-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.connectedListenOnly", "Conectado (Solo escucha)")}>
        <Wifi size={16} className="text-green-400" />
      </div>
    );
  }

  if (status === 'reconnecting') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-orange-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.reconnecting", "Reconectando...")}>
        <Loader2 size={16} className="text-orange-400 animate-spin" />
      </div>
    );
  }

  if (status === 'reconnected') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-emerald-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.audioReconnected", "Audio reconectado")}>
        <CheckCircle2 size={16} className="text-emerald-400" />
      </div>
    );
  }

  if (status === 'reconnect-failed') {
    return (
      <div className={`flex items-center justify-center rounded-full bg-red-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.reconnectionFailed", "ReconexiÃ³n fallida")}>
        <RotateCcw size={16} className="text-red-400" />
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-center rounded-full bg-red-500/20 p-1.5 ${className}`} title={translate("liveAudio:LiveAudioStatusBadge.disconnected", "Desconectado")}>
      <WifiOff size={16} className="text-red-400" />
    </div>
  );
};
