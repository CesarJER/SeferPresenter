import { translate } from '../i18n/runtime';
import { useUiTranslation } from '../i18n/useUiTranslation';
import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Save, Download, Upload, X, Clock, Trash2, Volume2, Music, AlertTriangle, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { Presentation } from '../types/presentation';
import type { AudioSyncMap, AudioSyncCue, AudioSyncMode } from '../types/audio';
import { findScriptureRange } from '../utils/scriptureLookup';
import { sanitizeSlideHtml } from '../utils/hebrewText';
import { validateAudioSyncMaps } from '../utils/validation';
import { sameValue } from '../utils/catalogMerge';
import { hasCatalogRevision } from '../utils/catalogApi';
import { remapSyncTimes, useSyncPresentationReview } from '../hooks/useSyncPresentationReview';
import { SyncPresentationReview } from './SyncPresentationReview';

interface AudioSyncEditorProps {
  isOpen: boolean;
  onClose: () => void;
  presentations: Presentation[];
  activePresentationId: string | null;
  activeAudioSrc?: string | null;
  availableAudioFiles: string[];
  audioSyncMaps: AudioSyncMap[];
  onAudioSyncMapsChange: (maps: AudioSyncMap[], baseMaps?: AudioSyncMap[]) => void | AudioSyncMap[] | Promise<void | AudioSyncMap[]>;
}

interface DisplayRow {
  key: string;
  slideIndex: number;
  label: string;
  lines: string[];
  type: 'slide' | 'verse';
  verse?: string;
}

export const AudioSyncEditor: React.FC<AudioSyncEditorProps> = ({
  isOpen,
  onClose,
  presentations,
  activePresentationId,
  activeAudioSrc,
  availableAudioFiles,
  audioSyncMaps,
  onAudioSyncMapsChange,
}) => {
  useUiTranslation('audioEditor');
  const [selectedPresentationId, setSelectedPresentationId] = useState<string>('');
  const [selectedAudioFile, setSelectedAudioFile] = useState<string>('');
  
  // Loaded display rows (standard slides + expanded scripture verses)
  const [displayRows, setDisplayRows] = useState<DisplayRow[]>([]);
  const [loadingRows, setLoadingRows] = useState<boolean>(false);
  
  // Map of row key -> time in seconds
  const [rowTimes, setRowTimes] = useState<Record<string, string>>({});
  
  // Sync Map metadata
  const [defaultVolume, setDefaultVolume] = useState<number>(0.7);
  const [defaultSyncMode, setDefaultSyncMode] = useState<AudioSyncMode>('unilateral');

  // Audio player state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0.7);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [isConfigCollapsed, setIsConfigCollapsed] = useState<boolean>(false);

  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);
  const userSelectedPresentationRef = useRef(false);
  const editBaseMapsRef = useRef(audioSyncMaps);
  const [isSaving, setIsSaving] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sourceReview = useSyncPresentationReview(selectedPresentationId, isOpen, presentations);
  const [savedVersion, setSavedVersion] = useState(0);

  // Initialize selected presentation and audio
  useEffect(() => {
    if (!isOpen) { dirtyRef.current = false; initializedRef.current = false; userSelectedPresentationRef.current = false; return; }
    if (dirtyRef.current || initializedRef.current) return;
    if (isOpen) {
      const initialAudio = selectedAudioFile || activeAudioSrc || '';
      if (initialAudio !== selectedAudioFile) setSelectedAudioFile(initialAudio);


      let initialPresId = selectedPresentationId || '';
      if (!initialPresId && initialAudio) {

        const existingMap = audioSyncMaps.find((m) => m.audioSrc === initialAudio);
        if (existingMap) {
          initialPresId = existingMap.presentationId;
        }
      }

      if (!initialPresId) {
        initialPresId = activePresentationId || (presentations[0]?.id ?? '');
      }

      if (initialPresId && presentations.some(p => p.id === initialPresId)) initializedRef.current = true;
      setSelectedPresentationId(initialPresId);
    }
  }, [isOpen, activePresentationId, activeAudioSrc, presentations, audioSyncMaps, selectedPresentationId, selectedAudioFile]);

  // Load available sync map if it exists for this presentation + audio
  useEffect(() => {
    if (dirtyRef.current) return;
    editBaseMapsRef.current = audioSyncMaps;
    if (!selectedPresentationId || !selectedAudioFile) {
      setRowTimes({});
      return;
    }

    const existingMap = audioSyncMaps.find(
      (m) => m.presentationId === selectedPresentationId && m.audioSrc === selectedAudioFile
    );

    if (existingMap) {
      setDefaultVolume(existingMap.defaultVolume ?? 0.7);
      setDefaultSyncMode(existingMap.defaultSyncMode ?? 'unilateral');
      
      const times: Record<string, string> = {};
      existingMap.cues.forEach((cue) => {
        // Construct key that matches how displayRows are keyed
        const key = cue.verse 
          ? `slide-${cue.slideIndex}-verse-${cue.verse}` 
          : `slide-${cue.slideIndex}`;
        times[key] = cue.timeSec.toString();
      });
      setRowTimes(times);
    } else {
      setRowTimes({});
      setDefaultVolume(0.7);
      setDefaultSyncMode('unilateral');
    }
  }, [selectedPresentationId, selectedAudioFile, audioSyncMaps, savedVersion]);

  // Expand slides (standard vs scripture verses)
  useEffect(() => {
    const presentation = sourceReview.reviewed;
    if (!presentation) {
      setDisplayRows([]);
      return;
    }

    let active = true;
    setLoadingRows(true);

    const loadAndBuildRows = async () => {
      try {
        const rows: DisplayRow[] = [];
        
        for (let idx = 0; idx < presentation.slides.length; idx++) {
          const slide = presentation.slides[idx];
          const isScripture = slide.type === 'sefer' || slide.type === 'tanaj' || !!slide.scriptureBook;
          
          if (isScripture && slide.scriptureBook && slide.scriptureChapter && slide.scriptureVerseStart) {
            try {
              // Load verses in range
              const verses = await findScriptureRange(
                slide.scriptureBook,
                slide.scriptureChapter,
                slide.scriptureVerseStart,
                slide.scriptureVerseEnd || slide.scriptureVerseStart
              );

              if (verses.length > 0) {
                // Add an entry for each verse in the scripture slide
                verses.forEach((v) => {
                  rows.push({
                    key: `slide-${idx}-verse-${v.verse}`,
                    slideIndex: idx,
                    label: `${slide.scriptureBook} ${slide.scriptureChapter}:${v.verse}`,
                    lines: [v.verseNikud, v.transliteration, v.translation],
                    type: 'verse',
                    verse: v.verse,
                  });
                });
              } else {
                // Fallback to single row if no verses loaded
                rows.push({
                  key: `slide-${idx}`,
                  slideIndex: idx,
                  label: slide.label || `Diapositiva ${idx + 1}`,
                  lines: slide.lines || [],
                  type: 'slide',
                });
              }
            } catch (err) {
              console.error('Error materializing scripture slide verses for editor:', err);
              // Fallback
              rows.push({
                key: `slide-${idx}`,
                slideIndex: idx,
                label: slide.label || `Diapositiva ${idx + 1}`,
                lines: slide.lines || [],
                type: 'slide',
              });
            }
          } else {
            // Standard Slide
            rows.push({
              key: `slide-${idx}`,
              slideIndex: idx,
              label: slide.label || `Diapositiva ${idx + 1}`,
              lines: slide.lines || [],
              type: 'slide',
            });
          }
        }

        if (active) {
          setDisplayRows(rows);
        }
      } catch (err) {
        console.error('Failed to load slides details for editor:', err);
      } finally {
        if (active) {
          setLoadingRows(false);
        }
      }
    };

    loadAndBuildRows();

    return () => {
      active = false;
    };
  }, [selectedPresentationId, sourceReview.reviewed]);

  // Audio Playback Listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Reset player states when source changes
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    if (selectedAudioFile) {
      // Set src imperatively so it's committed before calling load()
      // encodeURI handles spaces and accented characters in filenames
      audio.src = encodeURI(selectedAudioFile);
      audio.load();
    } else {
      audio.src = '';
    }

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDurationChange = () => setDuration(audio.duration || 0);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('durationchange', handleDurationChange);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('durationchange', handleDurationChange);
    };
  }, [selectedAudioFile]);

  // Sync playback rate to the audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate, selectedAudioFile]);

  // Handle Play/Pause
  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !selectedAudioFile) return;

    if (audio.paused) {
      audio.play().catch((err) => console.error('Error playing audio in editor:', err));
    } else {
      audio.pause();
    }
  };

  // Handle Seek
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = val;
      setCurrentTime(val);
    }
  };

  // Handle Volume Change
  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    const audio = audioRef.current;
    if (audio) {
      audio.volume = val;
    }
  };

  // Format Time (mm:ss.SS)
  const formatTime = (timeSec: number) => {
    if (isNaN(timeSec)) return '00:00.00';
    const minutes = Math.floor(timeSec / 60);
    const seconds = Math.floor(timeSec % 60);
    const ms = Math.floor((timeSec % 1) * 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  // Capture current play time for a row
  const handleCaptureTime = (rowKey: string) => {
    if (!selectedAudioFile) return;
    const timeVal = parseFloat(currentTime.toFixed(2));
    dirtyRef.current = true;
    setRowTimes((prev) => ({
      ...prev,
      [rowKey]: timeVal.toString(),
    }));
  };

  // Manual time input change
  const handleTimeInputChange = (rowKey: string, val: string) => {
    dirtyRef.current = true;
    setRowTimes((prev) => ({
      ...prev,
      [rowKey]: val,
    }));
  };

  // Remove cue time
  const handleClearTime = (rowKey: string) => {
    dirtyRef.current = true;
    setRowTimes((prev) => {
      const copy = { ...prev };
      delete copy[rowKey];
      return copy;
    });
  };

  // Clear all cues
  const handleClearAll = () => {
    if (window.confirm(translate("audioEditor:AudioSyncEditor.areYouSureYouWantToDeleteAllTimestamps", "¿Está seguro de que desea eliminar todas las marcas de tiempo?"))) {
      dirtyRef.current = true;
      setRowTimes({});
    }
  };

  // Save changes
  const handleSave = async () => {
    if (isSaving) return;
    if (!selectedPresentationId) {
      alert(translate("audioEditor:AudioSyncEditor.pleaseSelectAPresentation", "Por favor seleccione una presentación."));
      return;
    }
    if (!selectedAudioFile) {
      alert(translate("audioEditor:AudioSyncEditor.pleaseSelectAnAudioFile", "Por favor seleccione un archivo de audio."));
      return;
    }
    setIsSaving(true);
    try {
      const latest = await sourceReview.refresh();
      if (!latest || !sameValue(sourceReview.reviewed?.slides, latest.slides)) return;
      await saveMap();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally { setIsSaving(false); }
  };

  const saveMap = async () => {
    if (!selectedPresentationId) {
      alert(translate("audioEditor:AudioSyncEditor.pleaseSelectAPresentation", "Por favor seleccione una presentación."));
      return;
    }
    if (!selectedAudioFile) {
      alert(translate("audioEditor:AudioSyncEditor.pleaseSelectAnAudioFile", "Por favor seleccione un archivo de audio."));
      return;
    }

    // Build cues array
    const cues: AudioSyncCue[] = [];
    
    displayRows.forEach((row) => {
      const timeValStr = rowTimes[row.key];
      if (timeValStr !== undefined && timeValStr.trim() !== '') {
        const timeSec = parseFloat(timeValStr);
        if (!isNaN(timeSec) && timeSec >= 0) {
          cues.push({
            timeSec,
            slideIndex: row.slideIndex,
            ...(row.verse ? { verse: row.verse } : {}),
          });
        }
      }
    });

    // Sort cues chronologically
    cues.sort((a, b) => a.timeSec - b.timeSec);

    // Existing sync map or create new one
    let baseMaps = editBaseMapsRef.current;
    if (!hasCatalogRevision(baseMaps) && hasCatalogRevision(audioSyncMaps)) {
      if (audioSyncMaps.some(map => map.presentationId === selectedPresentationId && map.audioSrc === selectedAudioFile)) {
        throw new Error(`${translate('common:catalogMerge.unresolved', 'Resuelve todos los conflictos antes de guardar.')} ${translate('common:catalogMerge.cancelled', 'Guardado cancelado. Tu borrador se conserva.')}`);
      }
      // A draft without a loaded baseline may only create a previously absent pair.
      baseMaps = audioSyncMaps;
    }
    const existingIndex = baseMaps.findIndex(
      (m) => m.presentationId === selectedPresentationId && m.audioSrc === selectedAudioFile
    );

    const mapId = existingIndex >= 0 ? baseMaps[existingIndex].id : `sync-${Date.now()}`;
    
    // Automatically determine name from clean audio filename (without extension)
    const filename = selectedAudioFile.split('/').pop()?.split('.')[0] || translate("audioEditor:AudioSyncEditor.synchronization", "Sincronización");
    const mapName = decodeURIComponent(filename);

    const newMap: AudioSyncMap = {
      id: mapId,
      name: mapName,
      audioSrc: selectedAudioFile,
      presentationId: selectedPresentationId,
      cues,
      defaultSyncMode,
      defaultVolume,
    };

    const updatedMaps = [...baseMaps];
    if (existingIndex >= 0) {
      updatedMaps[existingIndex] = newMap;
    } else {
      updatedMaps.push(newMap);
    }

    setIsSaving(true);
    try {
      const saved = await onAudioSyncMapsChange(updatedMaps, baseMaps);
      dirtyRef.current = false;
      editBaseMapsRef.current = saved || updatedMaps;
      setSavedVersion(version => version + 1);
      alert(translate("audioEditor:AudioSyncEditor.synchronizationSavedSuccessfully", "Sincronización guardada correctamente."));
    } catch (err) {
      alert(err instanceof Error ? err.message : translate("audioEditor:AudioSyncEditor.couldNotSaveYourDraftIsPreserved", "No se pudo guardar. Tu borrador se conserva."));
    } finally { setIsSaving(false); }
  };

  // Export JSON
  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(audioSyncMaps, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `audio_sync_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (Array.isArray(parsed)) {
          // Quick validation of schema
          const isValid = parsed.every(
            (item) => typeof item.id === 'string' && typeof item.audioSrc === 'string' && Array.isArray(item.cues)
          );
          if (isValid) {
            const validation = validateAudioSyncMaps(parsed);
            if (!validation.ok || !validation.value) {
              alert(translate("audioEditor:AudioSyncEditor.theJsonFileFormatIsInvalid", "El formato del archivo JSON no es valido:\n{{value1}}", { value1: validation.errors.slice(0, 8).join('\n') }));
              return;
            }
            const saved = await onAudioSyncMapsChange(validation.value, editBaseMapsRef.current);
            dirtyRef.current = false;
            editBaseMapsRef.current = saved || validation.value;
            setSavedVersion(version => version + 1);
            alert(translate("audioEditor:AudioSyncEditor.synchronizationMapsImportedSuccessfully", "Mapas de sincronización importados correctamente."));
          } else {
            alert(translate("audioEditor:AudioSyncEditor.theJsonFileFormatIsInvalid_492f41", "El formato del archivo JSON no es válido."));
          }
        } else {
          alert(translate("audioEditor:AudioSyncEditor.theJsonFileMustContainAnArrayOfMaps", "El archivo JSON debe contener un arreglo de mapas."));
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : translate("audioEditor:AudioSyncEditor.couldNotImportYourDraftIsPreserved", "No se pudo importar. Tu borrador se conserva."));
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset
  };

  if (!isOpen) return null;

  return (
    <div className="w-full h-dvh bg-gray-900 text-white flex flex-col overflow-hidden">
      
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-950 px-6 py-4 shrink-0 shadow-md">
        <h2 className="flex items-center gap-3 text-xl font-extrabold text-yellow-500">
          <Music className="h-6 w-6 text-yellow-500 animate-pulse" />
          <span>{translate("audioEditor:AudioSyncEditor.musicSynchronizationEditor", "Editor de Sincronización de Música (🎼)")}</span>
        </h2>
        <button
          type="button"
          onClick={() => {
            if (audioRef.current) audioRef.current.pause();
            onClose();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-900 bg-red-950/20 hover:bg-red-900 hover:text-white transition-all text-red-400 font-bold text-xs cursor-pointer shadow-sm"
          title={translate("audioEditor:AudioSyncEditor.closeEditorWindow", "Cerrar ventana del editor")}
        >
          <X size={14} />
          <span>{translate("audioEditor:AudioSyncEditor.closeEditor", "Cerrar Editor")}</span>
        </button>
      </div>

      {/* Main Body Layout */}
      {sourceReview.changed && sourceReview.reviewed && <SyncPresentationReview before={sourceReview.reviewed} after={sourceReview.latest} times={rowTimes} onReview={() => {
        if (!sourceReview.latest || !sourceReview.reviewed) return;
        try {
          const mapped = remapSyncTimes(sourceReview.reviewed, sourceReview.latest, rowTimes);
          dirtyRef.current = true;
          setRowTimes(mapped);
          sourceReview.accept();
        } catch (err) { alert(err instanceof Error ? err.message : String(err)); }
      }} />}
      {sourceReview.error && <div role="alert" className="m-3 shrink-0 rounded border border-red-700 p-3">
        {translate('audioEditor:syncReview.failed', 'No se pudo comprobar la presentación. Tus marcas se conservan; comprueba la conexión antes de guardar.')}
        <button type="button" onClick={() => { void sourceReview.refresh().catch(() => {}); }} className="ms-3 underline">{translate('audioEditor:syncReview.retry', 'Comprobar de nuevo')}</button>
      </div>}
      <fieldset disabled={isSaving} className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row">
        
        {/* Sidebar / Controls Panel */}
        <div className="w-full md:w-80 border-r border-gray-800 bg-gray-950/40 p-3.5 shrink-0 flex flex-col gap-3.5 overflow-y-auto">          {/* Collapsible Header */}
          <button
            type="button"
            onClick={() => setIsConfigCollapsed(!isConfigCollapsed)}
            className="flex items-center justify-between w-full text-start text-xs font-extrabold uppercase text-gray-400 tracking-wider hover:text-white bg-gray-900 border border-gray-800 p-2 rounded-sm transition-colors cursor-pointer"
          >
            <span>{translate("audioEditor:AudioSyncEditor.settingsAndTracks", "⚙️ Configuración y Pistas")}</span>
            <span className="text-yellow-500 font-mono text-[10px]">
              {isConfigCollapsed ? translate("audioEditor:AudioSyncEditor.show", "MOSTRAR ▽") : translate("audioEditor:AudioSyncEditor.hide", "OCULTAR △")}
            </span>
          </button>

          {!isConfigCollapsed && (
            <div className="flex flex-col gap-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-3">
                {/* Audio File Selector */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{translate("audioEditor:AudioSyncEditor.audioTrack", "Pista de Audio")}</label>
                  <select
                    value={selectedAudioFile}
                    onChange={(e) => {
                      if (dirtyRef.current && !window.confirm(translate("audioEditor:AudioSyncEditor.discardTheDraftToChangeTracks", "¿Descartar el borrador para cambiar de pista?"))) return;
                      dirtyRef.current = false;
                      const audioFile = e.target.value;
                      setSelectedAudioFile(audioFile);
                      if (audioFile && !userSelectedPresentationRef.current) {
                        const existingMap = audioSyncMaps.find((m) => m.audioSrc === audioFile);
                        if (existingMap) {
                          setSelectedPresentationId(existingMap.presentationId);
                        }
                      }
                    }}
                    className="w-full text-xs bg-gray-900 border border-gray-800 rounded-sm px-2.5 py-1.5 focus:border-yellow-500 outline-hidden text-white cursor-pointer shadow-xs"
                  >
                    <option value="">{translate("audioEditor:AudioSyncEditor.selectTrack", "-- Seleccionar Pista --")}</option>
                    {availableAudioFiles.map((file) => (
                      <option key={file} value={file}>
                        {decodeURIComponent(file.split('/').pop() || '')}
                      </option>
                    ))}
                  </select>
                  {availableAudioFiles.length === 0 && (
                    <div className="flex items-center gap-1.5 text-[9px] text-amber-500 bg-amber-500/10 p-1.5 rounded-sm border border-amber-900/30 mt-1">
                      <AlertTriangle size={11} />
                      <span>{translate("audioEditor:AudioSyncEditor.noAudioInPublicAudioMusic", "Sin audios en public/audio/music")}</span>
                    </div>
                  )}
                </div>

                {/* Presentation Selector */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{translate("audioEditor:AudioSyncEditor.presentation", "Presentación")}</label>
                  <select
                    value={selectedPresentationId}
                    onChange={(e) => {
                      if (dirtyRef.current && !window.confirm(translate("audioEditor:AudioSyncEditor.discardTheDraftToChangePresentations", "¿Descartar el borrador para cambiar de presentación?"))) return;
                      dirtyRef.current = false;
                      userSelectedPresentationRef.current = Boolean(e.target.value);
                      setSelectedPresentationId(e.target.value);
                    }}
                    className="w-full text-xs bg-gray-900 border border-gray-800 rounded-sm px-2.5 py-1.5 focus:border-yellow-500 outline-hidden text-white cursor-pointer shadow-xs"
                  >
                    <option value="">{translate("audioEditor:AudioSyncEditor.selectPresentation", "-- Seleccionar Presentación --")}</option>
                    {presentations.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Configuration Settings */}
              <div className="border-t border-gray-850 pt-3">
                <div className="grid grid-cols-2 gap-3.5 items-end">
                  {/* Default Sync Mode buttons */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">{translate("audioEditor:AudioSyncEditor.sync", "Sincro")}</span>
                      <span 
                        className="text-[10px] text-gray-500 hover:text-yellow-500 cursor-help"
                        title={translate("audioEditor:AudioSyncEditor.synchronizationModesBackgroundBackgroundMusicOneWayMusicChanges", "Modos de Sincronización:\n• Fondo (Música de fondo)\n• Uni (La música cambia las diapositivas)\n• Bi (Bidireccional: cambio manual también busca tiempo)")}
                      >
                        ❓
                      </span>
                    </div>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        onClick={() => { dirtyRef.current = true; setDefaultSyncMode('none'); }}
                        className={`flex-1 py-2 rounded border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center ${
                          defaultSyncMode === 'none'
                            ? 'bg-orange-650 border-orange-500 text-white'
                            : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-850'
                        }`}
                        title={translate("audioEditor:AudioSyncEditor.backgroundNoSynchronizationBackgroundMusic", "Fondo: Sin sincronizar (Música de fondo)")}
                      >
                        <Music size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { dirtyRef.current = true; setDefaultSyncMode('unilateral'); }}
                        className={`flex-1 py-2 rounded border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center ${
                          defaultSyncMode === 'unilateral'
                            ? 'bg-sky-650 border-sky-500 text-white'
                            : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-850'
                        }`}
                        title={translate("audioEditor:AudioSyncEditor.oneWayMusicAdvancesSlides", "Unilateral: La música avanza diapositivas")}
                      >
                        <ArrowUp size={12} className="stroke-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { dirtyRef.current = true; setDefaultSyncMode('bilateral'); }}
                        className={`flex-1 py-2 rounded border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center ${
                          defaultSyncMode === 'bilateral'
                            ? 'bg-emerald-650 border-emerald-500 text-white'
                            : 'bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-850'
                        }`}
                        title={translate("audioEditor:AudioSyncEditor.twoWayBidirectionalSynchronization", "Bilateral: Sincronización bidireccional")}
                      >
                        <ArrowUpDown size={12} className="stroke-3" />
                      </button>
                    </div>
                  </div>

                  {/* Initial Volume */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                      <span>{translate("audioEditor:AudioSyncEditor.initialVol", "Vol. Inicial")}</span>
                      <span className="text-yellow-500 font-mono">{Math.round(defaultVolume * 100)}%</span>
                    </div>
                    <div className="flex items-center h-9">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={defaultVolume}
                        onChange={(e) => { dirtyRef.current = true; setDefaultVolume(parseFloat(e.target.value)); }}
                        className="w-full h-1 bg-gray-800 rounded-sm appearance-none cursor-pointer accent-yellow-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Local Audio Player controls */}
          {selectedAudioFile && (
            <div className="border-t border-gray-850 pt-3 mt-auto md:mt-auto space-y-3">
              {/* Dynamic Speed Controller */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  <span>{translate("audioEditor:AudioSyncEditor.speed", "Velocidad")}</span>
                  <span className="text-yellow-500 font-mono">{playbackRate.toFixed(2)}{translate("audioEditor:AudioSyncEditor.x", "x")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.25"
                    max="4.0"
                    step="0.05"
                    value={playbackRate}
                    onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                    className="flex-1 h-1 bg-gray-800 rounded-sm appearance-none cursor-pointer accent-yellow-500"
                  />
                  <button
                    type="button"
                    onClick={() => setPlaybackRate(1.0)}
                    className="px-1.5 py-0.5 rounded-sm bg-gray-805 hover:bg-gray-750 text-gray-400 hover:text-white text-[9px] font-mono border border-gray-700 cursor-pointer"
                    title={translate("audioEditor:AudioSyncEditor.resetTo10x", "Restablecer a 1.0x")}
                  >
                    {translate("audioEditor:AudioSyncEditor.1x", "1x")}</button>
                </div>
              </div>

              {/* Play/Pause & Volume controls */}
              <div className="flex items-center gap-2 h-8 w-full">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-sm bg-yellow-600 hover:bg-yellow-500 text-white font-bold text-xs transition-all cursor-pointer shadow-sm"
                >
                  {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  <span>{isPlaying ? translate("audioEditor:AudioSyncEditor.pause", "Pausar") : translate("audioEditor:AudioSyncEditor.play", "Reproducir")}</span>
                </button>

                <div className="flex items-center gap-1.5 bg-gray-900 border border-gray-800 px-2 py-1.5 rounded-sm shadow-xs">
                  <Volume2 size={12} className="text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-14 h-1 bg-gray-800 rounded-sm appearance-none cursor-pointer accent-yellow-500"
                  />
                </div>
              </div>

              <audio
                ref={audioRef}
                preload="auto"
                className="hidden"
              />
            </div>
          )}

        </div>

        {/* Main Area: Slide/Verse Table */}
        <div className="flex-1 min-h-0 flex flex-col bg-gray-900">
          
          {/* Table Header toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0 bg-gray-950/20">
            <span className="text-xs font-bold text-gray-400">
              {translate('common:items', '{{count}} elementos', { count: displayRows.length })} {translate("audioEditor:AudioSyncEditor.inThePresentation", "en la presentación")}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleClearAll}
                disabled={Object.keys(rowTimes).length === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-sm border border-red-900 hover:bg-red-950/30 text-red-400 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer"
                title={translate("audioEditor:AudioSyncEditor.deleteAllTimestamps", "Eliminar todas las marcas")}
              >
                <Trash2 size={12} />
                <span>{translate("audioEditor:AudioSyncEditor.clearAll", "Limpiar Todo")}</span>
              </button>
            </div>
          </div>

          {/* Table Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-2">
            {loadingRows ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2.5">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
                <span className="text-sm">{translate("audioEditor:AudioSyncEditor.analyzingPresentationAndStructuringVerses", "Analizando presentación y estructurando versículos...")}</span>
              </div>
            ) : displayRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-gray-550 italic text-sm text-center">
                {translate("audioEditor:AudioSyncEditor.selectAPresentationOnTheLeftToStartMapping", "Seleccione una presentación a la izquierda para comenzar a mapear tiempos.")}</div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-800 text-start text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                    <th className="py-2.5 px-3 w-16">{translate("audioEditor:AudioSyncEditor.no", "Nro")}</th>
                    <th className="py-2.5 px-3 w-36">{translate("audioEditor:AudioSyncEditor.identifier", "Identificador")}</th>
                    <th className="py-2.5 px-3">{translate("audioEditor:AudioSyncEditor.slideContent", "Contenido de la Diapositiva")}</th>
                    <th className="py-2.5 px-3 w-48 text-end">{translate("audioEditor:AudioSyncEditor.timestamp", "Marca de Tiempo")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-850/40">
                  {displayRows.map((row) => {
                    const isVerse = row.type === 'verse';
                    const timeValue = rowTimes[row.key] || '';
                    
                    // Slide lines rendering
                    const line0 = row.lines[0] || '';
                    const safeLine0 = sanitizeSlideHtml(line0);
                    const line1 = row.lines[1] || '';
                    const line2 = row.lines[2] || '';
                    const isFallback1x = row.lines.length === 3 && line1 === '-' && line2 === '-';
                    const isTrilingual = row.lines.length === 3 && !isFallback1x && (line1.trim() !== '' || line2.trim() !== '');

                    return (
                      <tr
                        key={row.key}
                        className={`hover:bg-gray-850/20 transition-colors ${
                          isVerse ? 'bg-yellow-950/5 border-l-2 border-yellow-600/30' : ''
                        }`}
                      >
                        {/* 1. Index number */}
                        <td className="py-3 px-3 text-xs font-bold text-gray-400">
                          {row.slideIndex + 1}
                        </td>
                        
                        {/* 2. Label/Ident */}
                        <td className="py-3 px-3">
                          <span className={`text-xs px-2 py-0.5 rounded font-mono ${
                            isVerse ? 'bg-yellow-500/10 text-yellow-400 font-bold' : 'bg-gray-800 text-gray-300'
                          }`}>
                            {isVerse ? translate("audioEditor:AudioSyncEditor.v", "v{{value1}}", { value1: row.verse }) : translate("audioEditor:AudioSyncEditor.slide", "Slide")}
                          </span>
                          <div className="text-[10px] text-gray-400 mt-1 font-semibold truncate max-w-[130px]" title={row.label}>
                            {row.label}
                          </div>
                        </td>

                        {/* 3. Text content preview */}
                        <td className="py-3 px-3 text-xs">
                          {isTrilingual ? (
                            <div className="space-y-0.5">
                              <p 
                                className="text-[#f3c96a] font-bold text-end leading-relaxed"
                                dir="rtl"
                                dangerouslySetInnerHTML={{ __html: safeLine0 }}
                              />
                              {line1 && line1 !== '-' && <p className="text-sky-300/80 italic text-[11px]">{line1}</p>}
                              {line2 && line2 !== '-' && <p className="text-gray-450 text-[11px]">{line2}</p>}
                            </div>
                          ) : (
                            <p 
                              className="text-gray-300 leading-relaxed font-medium"
                              dangerouslySetInnerHTML={{ __html: safeLine0 }}
                            />
                          )}
                        </td>

                        {/* 4. Controls / Input */}
                        <td className="py-3 px-3 text-end">
                          <div className="flex items-center justify-end gap-1.5">
                            
                            {/* Play/Verify cue time */}
                            <button
                              type="button"
                              onClick={() => {
                                const seconds = parseFloat(timeValue);
                                const audio = audioRef.current;
                                if (audio && !isNaN(seconds) && seconds >= 0) {
                                  audio.currentTime = seconds;
                                  setCurrentTime(seconds);
                                  if (audio.paused) {
                                    audio.play().catch(err => console.error("Error verifying cue playback:", err));
                                  }
                                }
                              }}
                              disabled={!selectedAudioFile || !timeValue || isNaN(parseFloat(timeValue)) || parseFloat(timeValue) < 0}
                              className="flex items-center justify-center p-2 rounded-sm bg-sky-650/20 hover:bg-sky-600 hover:text-white text-sky-400 border border-sky-650 transition-colors disabled:opacity-30 disabled:hover:bg-sky-650/20 disabled:hover:text-sky-400 cursor-pointer shadow-xs"
                              title={translate("audioEditor:AudioSyncEditor.playTrackFromThisTimestamp", "Reproducir pista desde esta marca de tiempo")}
                            >
                              <Play size={13} />
                            </button>

                            {/* Manual Input */}
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="0.0"
                                value={timeValue}
                                onChange={(e) => handleTimeInputChange(row.key, e.target.value)}
                                className="w-16 text-end text-xs bg-gray-950 border border-gray-850 rounded-sm px-2 py-1.5 focus:border-yellow-500 outline-hidden font-mono"
                                title={translate("audioEditor:AudioSyncEditor.manualSeconds", "Segundos manuales")}
                              />
                              {timeValue && (
                                <span className="absolute end-1 top-2 text-[8px] text-gray-500 font-bold select-none pointer-events-none">{translate("audioEditor:AudioSyncEditor.s", "s")}</span>
                              )}
                            </div>

                            {/* Mark time button */}
                            <button
                              type="button"
                              onClick={() => handleCaptureTime(row.key)}
                              disabled={!selectedAudioFile}
                              className="flex items-center justify-center p-2 rounded-sm bg-yellow-600/20 hover:bg-yellow-600 hover:text-white text-yellow-500 border border-yellow-650 transition-colors disabled:opacity-30 disabled:hover:bg-yellow-600/20 disabled:hover:text-yellow-500 cursor-pointer shadow-xs"
                              title={translate("audioEditor:AudioSyncEditor.captureCurrentTime", "Capturar tiempo actual")}
                            >
                              <Clock size={13} />
                            </button>

                            {/* Clear time button */}
                            <button
                              type="button"
                              onClick={() => handleClearTime(row.key)}
                              disabled={!timeValue}
                              className="flex items-center justify-center p-2 rounded-sm bg-gray-800 hover:bg-red-950 hover:text-red-400 border border-gray-700 transition-colors disabled:opacity-20 disabled:hover:bg-gray-800 disabled:hover:text-gray-400 cursor-pointer"
                              title={translate("audioEditor:AudioSyncEditor.deleteTimestamp", "Eliminar marca")}
                            >
                              <X size={13} />
                            </button>

                          </div>
                        </td>

                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Footer Toolbar */}
          <div className="flex flex-col border-t border-gray-800 bg-gray-950 p-4 gap-4 shrink-0">
            {/* Full-width local progress bar */}
            {selectedAudioFile && (
              <div className="w-full space-y-1 bg-gray-900/40 p-3 rounded-sm border border-gray-850/60">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase text-gray-400 tracking-wider">
                  <span className="flex items-center gap-1.5 text-yellow-500">
                    <Clock size={12} className="animate-pulse" />
                    <span>{decodeURIComponent(selectedAudioFile.split('/').pop()?.split('.')[0] || 'Progreso')}</span>
                  </span>
                  <span className="text-yellow-500 font-mono text-[11px]">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-1.5 bg-gray-800 rounded-sm appearance-none cursor-pointer accent-yellow-500"
                />
              </div>
            )}

            {/* Buttons Row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {/* Export button */}
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-sm bg-gray-850 hover:bg-gray-800 text-gray-200 transition-colors cursor-pointer border border-gray-800"
                  title={translate("audioEditor:AudioSyncEditor.exportTimingDataToJson", "Exportar base de tiempos a JSON")}
                >
                  <Download size={13} />
                  <span>{translate("audioEditor:AudioSyncEditor.exportJson", "Exportar JSON")}</span>
                </button>

                {/* Import button */}
                <button
                  type="button"
                  onClick={handleImportClick}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-sm bg-gray-850 hover:bg-gray-800 text-gray-200 transition-colors cursor-pointer border border-gray-800"
                  title={translate("audioEditor:AudioSyncEditor.importTimingDataFromJson", "Importar base de tiempos desde JSON")}
                >
                  <Upload size={13} />
                  <span>{translate("audioEditor:AudioSyncEditor.importJson", "Importar JSON")}</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </div>

              {/* Save changes button */}
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || loadingRows || sourceReview.changed || !!sourceReview.error || !selectedPresentationId || !selectedAudioFile}
                className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-extrabold text-xs tracking-wider transition-all shadow-md shadow-yellow-950/20 disabled:opacity-40 disabled:hover:bg-yellow-600 cursor-pointer"
              >
                <Save size={14} />
                <span>{translate("audioEditor:AudioSyncEditor.saveConfiguration", "GUARDAR CONFIGURACIÓN")}</span>
              </button>
            </div>
          </div>

        </div>

      </fieldset>
    </div>
  );
};

