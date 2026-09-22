import type { VideoState } from '../types/presentation';

export interface VideoTimelineCorrectionInput {
  videoState: VideoState;
  nowMs: number;
}

export function calcExpectedVideoTime(input: VideoTimelineCorrectionInput): number {
  const { videoState, nowMs } = input;
  
  if (!videoState.isPlaying) {
    return videoState.currentTime;
  }
  
  // Calculate how much time has elapsed since the videoState was recorded.
  const elapsedSec = Math.max(0, (nowMs - videoState.timestamp) / 1000);
  let expectedSec = videoState.currentTime + (elapsedSec * videoState.speed);
  
  const startTime = videoState.startTime ?? 0;
  const endTime = videoState.endTime;
  const isLooping = videoState.loop !== false; // default to true if undefined, though typically it's defined
  
  if (endTime !== undefined && expectedSec >= endTime) {
    if (isLooping) {
      const duration = endTime - startTime;
      if (duration > 0) {
        expectedSec = startTime + ((expectedSec - startTime) % duration);
      } else {
        expectedSec = startTime;
      }
    } else {
      expectedSec = endTime; // Pauses at the end
    }
  } else if (videoState.duration > 0 && expectedSec >= videoState.duration) {
    if (isLooping) {
      expectedSec = expectedSec % videoState.duration;
    } else {
      expectedSec = videoState.duration;
    }
  }
  
  return expectedSec;
}
