import React from 'react';

interface LiveAudioAliasInputProps {
  alias: string;
  onChange: (alias: string) => void;
  disabled?: boolean;
}

export const LiveAudioAliasInput: React.FC<LiveAudioAliasInputProps> = ({ alias, onChange, disabled }) => {
  return (
    <div className="flex flex-col gap-1 mb-4">
      <label htmlFor="alias-input" className="text-sm text-gray-300 font-medium">
        Alias temporal
      </label>
      <input
        id="alias-input"
        type="text"
        value={alias}
        onChange={(e) => onChange(e.target.value.slice(0, 50))}
        placeholder="Ej. Juan Pérez"
        disabled={disabled}
        className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        maxLength={50}
      />
      <span className="text-xs text-gray-500">
        Este alias no persistirá y solo será visible para el equipo de moderación.
      </span>
    </div>
  );
};
