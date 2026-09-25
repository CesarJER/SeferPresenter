import React, { useState } from 'react';
import { Settings, Mic, Volume2, Music } from 'lucide-react';
import { useAudioDevices } from '../../../hooks/useAudioDevices';

export function AudioDeviceSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    devices,
    hasPermission,
    requestPermission,
    liveMicrophoneId,
    setLiveMicrophoneId,
    liveOutputId,
    setLiveOutputId,
    programOutputId,
    setProgramOutputId,
  } = useAudioDevices();

  const microphones = devices.filter(d => d.kind === 'audioinput');
  const speakers = devices.filter(d => d.kind === 'audiooutput');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`p-1 rounded transition-colors ${isOpen ? 'bg-zinc-700 text-white' : 'text-gray-400 hover:text-white hover:bg-zinc-800'}`}
        title="Configuración de dispositivos de audio"
        aria-label="Configuración de dispositivos de audio"
      >
        <Settings size={14} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-72 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl z-50 p-3 text-xs text-gray-200">
          <div className="flex justify-between items-center mb-3 pb-2 border-b border-zinc-800">
            <h4 className="font-semibold text-white">Dispositivos de Audio</h4>
          </div>

          {!hasPermission ? (
            <div className="text-center py-2">
              <p className="mb-2 text-zinc-400">Permite el acceso para listar los dispositivos con su nombre.</p>
              <button
                type="button"
                onClick={requestPermission}
                className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded"
              >
                Dar permiso
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-zinc-400 font-medium mb-1">
                  <Mic size={12} /> Micrófono (Live)
                </label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                  value={liveMicrophoneId}
                  onChange={e => setLiveMicrophoneId(e.target.value)}
                >
                  <option value="default">Por defecto del sistema</option>
                  {microphones.map(m => (
                    <option key={m.deviceId} value={m.deviceId}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-zinc-400 font-medium mb-1">
                  <Volume2 size={12} /> Salida de Voz (Live)
                </label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                  value={liveOutputId}
                  onChange={e => setLiveOutputId(e.target.value)}
                >
                  <option value="default">Por defecto del sistema</option>
                  {speakers.map(s => (
                    <option key={s.deviceId} value={s.deviceId}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-zinc-400 font-medium mb-1">
                  <Music size={12} /> Salida de Programa
                </label>
                <select
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none focus:border-emerald-500"
                  value={programOutputId}
                  onChange={e => setProgramOutputId(e.target.value)}
                >
                  <option value="default">Por defecto del sistema</option>
                  {speakers.map(s => (
                    <option key={s.deviceId} value={s.deviceId}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
