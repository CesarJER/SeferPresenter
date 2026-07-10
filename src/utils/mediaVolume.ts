const clamp01 = (value: number) => Math.max(0, Math.min(value, 1));

type AudioContextConstructor = new () => AudioContext;

interface ManagedMediaVolumeGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

const managedVolumeGraphs = new WeakMap<HTMLMediaElement, ManagedMediaVolumeGraph>();

let sharedAudioContext: AudioContext | null = null;
let interactionListenersAttached = false;

const getAudioContextConstructor = (): AudioContextConstructor | null => {
  if (typeof window === 'undefined') return null;
  return (
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext ||
    null
  );
};

export const isIosMediaVolumeQuirk = (): boolean => {
  if (typeof navigator === 'undefined') return false;

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
};

export const isMediaPlaybackBlockedError = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'NotAllowedError' || error.name === 'SecurityError');

const ensureSharedAudioContext = (): AudioContext | null => {
  if (sharedAudioContext && sharedAudioContext.state !== 'closed') return sharedAudioContext;

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) return null;

  try {
    sharedAudioContext = new AudioContextCtor();
    return sharedAudioContext;
  } catch {
    sharedAudioContext = null;
    return null;
  }
};

export const resumeManagedMediaAudio = async (): Promise<void> => {
  const context = ensureSharedAudioContext();
  if (!context || context.state === 'running' || context.state === 'closed') return;

  try {
    await context.resume();
  } catch {
    // Browser policy may still require a closer user gesture. Playback code will surface that.
  }
};

const handleUserActivation = () => {
  void resumeManagedMediaAudio();
};

const ensureInteractionListeners = () => {
  if (interactionListenersAttached || typeof window === 'undefined') return;
  interactionListenersAttached = true;

  window.addEventListener('pointerdown', handleUserActivation, { capture: true, passive: true });
  window.addEventListener('touchstart', handleUserActivation, { capture: true, passive: true });
  window.addEventListener('click', handleUserActivation, { capture: true, passive: true });
  window.addEventListener('keydown', handleUserActivation, { capture: true });
};

export const isIphoneDevice = (): boolean =>
  typeof navigator !== 'undefined' && /iPhone/.test(navigator.userAgent || '');

export const getManagedMediaAudioContext = (): AudioContext | null => {
  ensureInteractionListeners();
  return ensureSharedAudioContext();
};

const getManagedVolumeGraph = (media: HTMLMediaElement): ManagedMediaVolumeGraph | null => {
  const existing = managedVolumeGraphs.get(media);
  if (existing) return existing;

  if (!isIosMediaVolumeQuirk()) return null;
  // iOS can produce choppy playback when a normal music <audio> element is
  // rerouted through MediaElementAudioSourceNode. Keep audio on Safari's native
  // output path; the gain fallback remains available for projected video.
  if (media instanceof HTMLAudioElement) return null;

  const context = getManagedMediaAudioContext();
  if (!context) return null;

  try {
    const source = context.createMediaElementSource(media);
    const gain = context.createGain();

    source.connect(gain);
    gain.connect(context.destination);

    const graph = { context, source, gain };
    managedVolumeGraphs.set(media, graph);
    return graph;
  } catch {
    return null;
  }
};

export const setMediaOutputVolume = (media: HTMLMediaElement, volume: number): void => {
  const safeVolume = clamp01(Number.isFinite(volume) ? volume : 1);
  const graph = getManagedVolumeGraph(media);

  if (graph) {
    graph.gain.gain.value = safeVolume;
    return;
  }

  try {
    media.volume = safeVolume;
  } catch {
    // Some mobile browsers expose volume but do not allow assignment.
  }
};

export const getMediaOutputVolume = (media: HTMLMediaElement): number => {
  const graph = managedVolumeGraphs.get(media);
  if (graph) return graph.gain.gain.value;
  return Number.isFinite(media.volume) ? media.volume : 1;
};
