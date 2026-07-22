import React from 'react';
import { X, MessageSquare, KeyRound, Check, Trash2, ShieldAlert } from 'lucide-react';
import { useLiveAudioAvailability } from '../../hooks/useLiveAudioAvailability';
import type { PendingControlAuthorization } from '../../../../types/liveAudio';

export interface PrivateMessage {
  id: string;
  fromAlias: string;
  content: string;
  timestamp: number;
}

interface PrivateControlInboxProps {
  isOpen: boolean;
  isControlAuthorized: boolean;
  messages: PrivateMessage[];
  authorizationRequests: PendingControlAuthorization[];
  onApproveRequest: (sessionId: string) => void;
  onRejectRequest: (sessionId: string) => void;
  onDismissMessage: (id: string) => void;
}

export const PrivateControlInbox: React.FC<PrivateControlInboxProps> = ({
  isOpen,
  isControlAuthorized,
  messages,
  authorizationRequests,
  onApproveRequest,
  onRejectRequest,
  onDismissMessage
}) => {
  const { availability } = useLiveAudioAvailability();

  if (!isOpen) return null;

  if (!isControlAuthorized) {
    return (
      <div className="fixed top-16 right-0 md:right-4 w-full md:w-[400px] bg-gray-900 border border-red-800 md:rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="p-3 bg-red-900/50 flex items-center justify-between">
          <h3 className="font-bold text-red-200 text-sm">Acceso Denegado</h3>
        </div>
        <div className="p-4 text-sm text-gray-400">
          No eres un Control Autorizado. No tienes acceso a la bandeja privada ni a los alias descifrados.
        </div>
      </div>
    );
  }

  const hasItems = messages.length > 0 || authorizationRequests.length > 0;

  return (
    <div className="fixed top-16 right-0 md:right-4 w-full md:w-[400px] max-h-[70vh] bg-gray-900 border border-gray-700 md:rounded-lg shadow-2xl z-50 flex flex-col">
      <div className="p-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between shrink-0">
        <h3 className="font-bold text-gray-200 text-sm flex items-center gap-2">
          <MessageSquare size={16} /> Bandeja Privada
        </h3>
      </div>

      <div className="overflow-y-auto p-2 space-y-3">
        {availability === 'unsupported' && (
          <div className="bg-red-950/30 border border-red-900/50 rounded-md p-2 flex items-start gap-2">
            <ShieldAlert size={14} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-300">Audio no compatible en este navegador o contexto inseguro (requiere HTTPS o localhost).</p>
          </div>
        )}
        {(availability === 'disabled' || availability === 'misconfigured') && (
          <div className="bg-orange-950/30 border border-orange-900/50 rounded-md p-2 flex items-start gap-2">
            <ShieldAlert size={14} className="text-orange-400 mt-0.5 shrink-0" />
            <p className="text-xs text-orange-300">El servicio de Live Audio no está configurado o está deshabilitado en el servidor.</p>
          </div>
        )}

        {!hasItems && (
          <div className="p-4 text-center text-gray-500 text-sm italic">
            No hay notificaciones nuevas.
          </div>
        )}

        {/* Authorization Requests */}
        {authorizationRequests.map((req) => (
          <div key={req.controlSessionId} className="bg-blue-900/20 border border-blue-800/50 rounded-md p-3">
            <div className="flex items-center gap-2 mb-2">
              <KeyRound size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-blue-200">Solicitud de Control</span>
            </div>
            <div className="text-xs text-blue-300 mb-3">
              Código de verificación: <strong className="text-white text-base tracking-widest">{req.verificationCode}</strong>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => onApproveRequest(req.controlSessionId)}
                className="flex-1 flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 text-white py-1.5 rounded text-xs transition-colors"
              >
                <Check size={14} /> Aprobar
              </button>
              <button
                onClick={() => onRejectRequest(req.controlSessionId)}
                className="flex-1 flex items-center justify-center gap-1 bg-gray-700 hover:bg-gray-600 text-gray-200 py-1.5 rounded text-xs transition-colors"
              >
                <X size={14} /> Rechazar
              </button>
            </div>
          </div>
        ))}

        {/* Private Messages */}
        {messages.map((msg) => (
          <div key={msg.id} className="bg-gray-800 border border-gray-700 rounded-md p-3 group">
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs font-semibold text-gray-300">Mensaje de: <span className="text-white">{msg.fromAlias}</span></span>
              <button 
                onClick={() => onDismissMessage(msg.id)}
                className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                title="Descartar"
                aria-label={`Descartar mensaje de ${msg.fromAlias}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <p className="text-sm text-gray-200 leading-relaxed">
              "{msg.content}"
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
