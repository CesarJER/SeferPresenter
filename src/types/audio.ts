/**
 * Audio synchronization types for SeferPresenter.
 * 
 * The audio file "owns" the sync map — it knows which slide maps to which second.
 * This is analogous to a video track, where the media drives the navigation.
 */

/** Synchronization mode between audio playback and slide navigation */
export type AudioSyncMode = 'none' | 'unilateral' | 'bilateral';

/** A single time→slide mapping entry within a sync map */
export interface AudioSyncCue {
  /** Seconds into the audio track where this cue fires */
  timeSec: number;
  /** The slide index to navigate to */
  slideIndex: number;
  /** Optional: specific verse within a scripture slide (e.g. "1" or "3") */
  verse?: string;
}

/** 
 * A complete sync map: ties one audio file to one presentation's slide sequence.
 * Stored in audio_sync.json (server) or localStorage (singlefile).
 */
export interface AudioSyncMap {
  /** Unique ID for this mapping */
  id: string;
  /** Display name for this sync map (e.g. "Shema Yisrael — Coro") */
  name: string;
  /** Path to the audio file (relative to public/, e.g. "/audio/shema.mp3") */
  audioSrc: string;
  /** ID of the presentation this map applies to */
  presentationId: string;
  /** Ordered list of time cues */
  cues: AudioSyncCue[];
  /** Default sync mode when this track is loaded */
  defaultSyncMode: AudioSyncMode;
  /** Default volume 0-1 */
  defaultVolume: number;
}

/**
 * Runtime audio playback state, synchronized across tabs/devices.
 * This is the "live" state — what the presenter screen's <audio> element reflects.
 */
export interface AudioState {
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Current playback position in seconds */
  currentTime: number;
  /** Total duration of the loaded track */
  duration: number;
  /** Volume level 0-1 */
  volume: number;
  /** Path to the audio source file */
  audioSrc: string | null;
  /** ID of the active AudioSyncMap (if any) */
  activeSyncMapId: string | null;
  /** Current sync mode */
  syncMode: AudioSyncMode;
  /** Who last updated this state */
  lastUpdatedBy: 'controller' | 'projection';
  /** What specifically changed in the audio state */
  changeType?: 'track' | 'volume' | 'playState' | 'seek' | 'syncMode';
  /** Timestamp for conflict resolution */
  timestamp: number;
}

/** Default/initial audio state */
export const DEFAULT_AUDIO_STATE: AudioState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 0.7,
  audioSrc: null,
  activeSyncMapId: null,
  syncMode: 'none',
  lastUpdatedBy: 'controller',
  timestamp: Date.now(),
};
