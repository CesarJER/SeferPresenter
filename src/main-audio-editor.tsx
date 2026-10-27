import { UiLocaleProvider } from './i18n/UiLocaleProvider';
import { translate } from './i18n/runtime';
import { useUiTranslation } from './i18n/useUiTranslation';
import { loadCatalog, audioSyncCatalogOptions } from './utils/catalogApi';
import { useCatalogSave } from './hooks/useCatalogSave';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { AudioSyncEditor } from './components/AudioSyncEditor';
import type { AudioSyncMap } from './types/audio';
import type { Presentation } from './types/presentation';
import { normalizePresentation } from './utils/normalizePresentation';
import { validateAudioSyncMaps, validatePresentationList } from './utils/validation';

const fetchJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const AudioEditorApp = () => {
  useUiTranslation('audioEditor');
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [audioSyncMaps, setAudioSyncMaps] = useState<AudioSyncMap[]>([]);
  const { save: saveAudioCatalog, dialog: audioConflicts } = useCatalogSave('/api/audio-sync', audioSyncCatalogOptions);
  const [availableAudioFiles, setAvailableAudioFiles] = useState<string[]>([]);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadEditorData = async () => {
      try {
        const [presentationsPayload, audioSyncPayload, audioFilesPayload] = await Promise.all([
          loadCatalog<Presentation>('/api/presentations', normalizePresentation),
          loadCatalog<AudioSyncMap>('/api/audio-sync'),
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
        setPresentations(presentationsPayload);
        setAudioSyncMaps(audioSyncPayload);
        setAvailableAudioFiles(audioFiles);
        setLoadError(null);
      } catch (err) {
        console.error('Error loading audio editor data', err);
        if (active) {
          setLoadError(translate("audioEditor:main_audio_editor.couldNotLoadAudioEditorData", "No se pudieron cargar los datos del editor de audio. {{value1}}", { value1: err instanceof Error ? err.message : '' }));
        }
      }
    };

    loadEditorData();

    return () => {
      active = false;
    };
  }, [reloadVersion]);

  useEffect(() => {
    const stream = new EventSource('/api/state-events');
    let active = true;
    let generation = 0;
    stream.onmessage = event => {
      if (event.data === 'heartbeat') return;
      try {
        if (JSON.parse(event.data).type !== 'AUDIO_SYNC_MAPS_UPDATE') return;
      } catch { return; }
      const request = ++generation;
      void loadCatalog<AudioSyncMap>('/api/audio-sync').then(maps => {
        const validation = validateAudioSyncMaps(maps);
        if (active && request === generation && validation.ok) setAudioSyncMaps(maps);
      }).catch(err => { if (active) setLoadError(err instanceof Error ? err.message : translate("audioEditor:main_audio_editor.couldNotUpdateAudioMaps", "No se pudieron actualizar los mapas de audio.")); });
    };
    return () => { active = false; stream.close(); };
  }, []);

  const handleAudioSyncMapsChange = useCallback(async (maps: AudioSyncMap[], baseMaps = audioSyncMaps) => {
    const validation = validateAudioSyncMaps(maps);
    if (!validation.ok || !validation.value) throw new Error(translate("audioEditor:main_audio_editor.invalidAudioMaps", "Mapas de audio inválidos"));
    const saved = await saveAudioCatalog(maps, baseMaps);
    setAudioSyncMaps(saved);
    return saved;
  }, [audioSyncMaps, saveAudioCatalog]);

  return (
    <div className="w-dvw h-dvh bg-gray-900 overflow-hidden">
      {audioConflicts}
      {loadError && (
        <div className="absolute left-4 right-4 top-4 z-50 rounded-sm border border-red-800 bg-red-950 px-4 py-3 text-sm font-semibold text-red-100 shadow-sm">
          {loadError}
          <button type="button" className="ml-3 underline" onClick={() => setReloadVersion(value => value + 1)}>{translate("audioEditor:main_audio_editor.retryLoading", "Reintentar carga")}</button>
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

const root = document.getElementById('root');
if (root) createRoot(root).render(
  <StrictMode><UiLocaleProvider role="audioEditor">
    <AudioEditorApp />
  </UiLocaleProvider></StrictMode>,
);
