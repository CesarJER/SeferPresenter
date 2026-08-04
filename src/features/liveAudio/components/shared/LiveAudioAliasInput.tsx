import React from 'react';

interface LiveAudioAliasInputProps {
  alias: string;
  onChange: (alias: string) => void;
  disabled?: boolean;
}

export const LiveAudioAliasInput: React.FC<LiveAudioAliasInputProps> = ({ alias, onChange, disabled }) => {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <label htmlFor="alias-input" className="text-sm text-gray-300 font-medium">
        Alias temporal
      </label>
      <input
        id="alias-input"
        type="text"
        value={alias}
        onChange={(e) => onChange(e.target.value.slice(0, 50))}
        placeholder="Ej. Shalom, Daniel, Raquel, Vida de Paz..."
        disabled={disabled}
        className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        maxLength={50}
      />
      <span className="text-xs text-gray-500">
        Este alias no persistirá. Solo se mostrará a moderación, salvo que autorices compartirlo con otros participantes activos.
      </span>
    </div>
  );
};
