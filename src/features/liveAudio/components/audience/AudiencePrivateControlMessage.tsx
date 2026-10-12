import React, { useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';

interface AudiencePrivateControlMessageProps {
  onClose: () => void;
  onSend: (message: string) => boolean | Promise<boolean>;
}

export const AudiencePrivateControlMessage: React.FC<AudiencePrivateControlMessageProps> = ({
  onClose,
  onSend,
}) => {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    messageRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || isSending) return;

    setError(null);
    setIsSending(true);
    try {
      const sent = await onSend(trimmed);
      if (!sent) {
        setError('No se pudo enviar todavia. Espera unos segundos y vuelve a intentarlo.');
        return;
      }
      setMessage('');
      onClose();
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 pointer-events-auto">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="private-control-message-title"
        aria-describedby="private-control-message-description"
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col"
      >
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 id="private-control-message-title" className="text-lg font-medium text-white">Mensaje a Control</h2>
          <button 
            onClick={onClose}
            aria-label="Cerrar mensaje privado"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <p id="private-control-message-description" className="text-xs text-gray-400 mb-3">
            Este mensaje es privado y solo será visible para el equipo de moderación autorizado. No es un chat público.
          </p>
          <form id="message-form" onSubmit={handleSubmit}>
            <textarea
              ref={messageRef}
              aria-label="Mensaje privado para Control"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
              placeholder="Escribe tu mensaje aquí..."
              className="w-full h-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              maxLength={500}
            />
            {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
          </form>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 flex justify-end gap-3 bg-gray-900/50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="message-form"
            disabled={!message.trim() || isSending}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg shadow-md transition-all"
          >
            <Send className="w-4 h-4" />
            {isSending ? 'Enviando' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
};
