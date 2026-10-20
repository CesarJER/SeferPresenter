import React from 'react';
import { X } from 'lucide-react';

interface ActiveParticipantsPanelProps {
  isAuthorized: boolean;
  participants: string[];
  isAliasVisible: boolean;
  onAliasVisibilityChange: (checked: boolean) => void;
  onClose: () => void;
}

export const ActiveParticipantsPanel: React.FC<ActiveParticipantsPanelProps> = ({
  isAuthorized,
  participants,
  isAliasVisible,
  onAliasVisibilityChange,
  onClose,
}) => (
  <div className="w-full rounded-lg border border-white/10 bg-gray-900/95 p-4 text-gray-100 shadow-2xl backdrop-blur-md">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Participantes</h2>
      <button
        onClick={onClose}
        className="rounded-sm p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        title="Cerrar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>

    <label className="mt-3 flex cursor-pointer select-none items-start gap-2 text-sm text-gray-300">
      <input
        type="checkbox"
        checked={isAliasVisible}
        onChange={(event) => onAliasVisibilityChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-blue-500"
      />
      <span>Mostrar mi alias a otros participantes</span>
    </label>

    {isAuthorized && (
      <div className="mt-4 max-h-[calc(100vh-200px)] overflow-y-auto border-t border-white/10 pt-3">
        {participants.length === 0 ? (
          <p className="text-sm text-gray-400">No hay participantes visibles ahora.</p>
        ) : (
          <ul className="space-y-1 text-sm text-gray-200">
            {participants.map((participant, index) => (
              <li key={`${participant}-${index}`} className="truncate">
                {participant}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}
  </div>
);
