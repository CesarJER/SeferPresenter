import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AudioSyncEditor } from './components/AudioSyncEditor';
import type { AudioSyncMap } from './types/audio';
import type { Presentation } from './types/presentation';
import { normalizePresentation } from './utils/normalizePresentation';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const AudioEditorApp = () => {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadEditorData = async () => {
      try {
        const [presentationsPayload, audioSyncPayload, audioFilesPayload] = await Promise.all([
          fetchJson<unknown>('/api/presentations'),
          fetchJson<unknown>('/api/audio-sync'),
          fetchJson<unknown>('/api/audio'),
        ]);

        const presentationValidation = validatePresentationList(presentationsPayload);
        if (!presentationValidation.ok || !presentationValidation.value) {
          throw new Error(`Invalid presentations payload: ${presentationValidation.errors.join('; ')}`);
        }

        const audioSyncValidation = validateAudioSyncMaps(audioSyncPayload);
        if (!audioSyncValidation.ok || !audioSyncValidation.value) {
          throw new Error(`Invalid audio sync payload: ${audioSyncValidation.errors.join('; ')}`);
        }

        const audioFiles = Array.isArray(audioFilesPayload)
          ? audioFilesPayload.filter((file): file is string => typeof file === 'string')
          : [];

        if (!active) return;
        setPresentations(presentationValidation.value.map(normalizePresentation));
        setAudioSyncMaps(audioSyncValidation.value);
        setAvailableAudioFiles(audioFiles);
        setLoadError(null);
      } catch (err) {
        console.error('Error loading audio editor data', err);
        if (active) {
          setLoadError('No se pudieron cargar los datos del editor de audio.');
        }
      }
    };

    loadEditorData();

    return () => {
      active = false;
    };
  }, []);

  const handleAudioSyncMapsChange = useCallback((maps: AudioSyncMap[]) => {
    const validation = validateAudioSyncMaps(maps);
    if (!validation.ok || !validation.value) {
      console.error('Refusing to save invalid audio sync maps', validation.errors);
      alert(`No se guardaron los mapas de audio porque contienen datos invalidos:\n${validation.errors.slice(0, 5).join('\n')}`);
      return;
    }

    setAudioSyncMaps(validation.value);
    fetch('/api/audio-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validation.value),
    }).catch((err) => {
      console.error('Error saving audio sync maps', err);
      alert('No se pudieron guardar los mapas de audio.');
    });
  }, []);

  return (
    <div className="w-dvw h-dvh bg-gray-900 overflow-hidden">
      {loadError && (
        <div className="absolute left-4 right-4 top-4 z-50 rounded border border-red-800 bg-red-950 px-4 py-3 text-sm font-semibold text-red-100 shadow">
          {loadError}
        </div>
      )}
      <AudioSyncEditor
        isOpen={true}
        onClose={() => window.close()}
        presentations={presentations}
        activePresentationId={presentations[0]?.id ?? null}
        activeAudioSrc={null}
        availableAudioFiles={availableAudioFiles}
        audioSyncMaps={audioSyncMaps}
        onAudioSyncMapsChange={handleAudioSyncMapsChange}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioEditorApp />
  </StrictMode>,
);
