import React, { useEffect, useRef, useState } from 'react';
import { CollapsiblePrivacyNotice } from '../shared/CollapsiblePrivacyNotice';
import { LiveAudioAliasInput } from '../shared/LiveAudioAliasInput';
import { X } from 'lucide-react';
import type { LiveAudioExternalBroadcastState } from '../../../../types/liveAudio';

interface AudienceInterventionModalProps {
  onClose: () => void;
  defaultAliasVisible?: boolean;
  externalBroadcastState: LiveAudioExternalBroadcastState;
  onSubmit: (alias: string, isAliasVisible: boolean) => void;
}

export const AudienceInterventionModal: React.FC<AudienceInterventionModalProps> = ({
  onClose,
  defaultAliasVisible,
  externalBroadcastState,
  onSubmit,
}) => {
  const [alias, setAlias] = useState('');
  const [isAgreed, setIsAgreed] = useState(false);
  const [isAliasVisible, setIsAliasVisible] = useState(defaultAliasVisible ?? false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isAgreed && alias.trim()) {
      onSubmit(alias.trim(), isAliasVisible);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 pointer-events-auto">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audience-intervention-title"
        className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]"
      >
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <h2 ref={titleRef} tabIndex={-1} id="audience-intervention-title" className="text-xl font-semibold text-white outline-none">Participar en la sesión</h2>
          <button 
            onClick={onClose}
            aria-label="Cerrar dialogo de intervencion"
            className="p-2 text-gray-400 hover:text-white rounded-full hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          <CollapsiblePrivacyNotice
            externalBroadcastState={externalBroadcastState}
            onCheckboxesChange={setIsAgreed}
          />

          {isAgreed && (
            <form id="intervention-form" onSubmit={handleSubmit} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <LiveAudioAliasInput alias={alias} onChange={setAlias} />
              <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAliasVisible}
                  onChange={(event) => setIsAliasVisible(event.target.checked)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
                <span className="text-sm text-gray-300">
                  Mostrar mi alias a otros participantes activos
                </span>
              </label>
            </form>
          )}
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
            form="intervention-form"
            disabled={!isAgreed || !alias.trim()}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium rounded-lg shadow-lg transition-all"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
};
