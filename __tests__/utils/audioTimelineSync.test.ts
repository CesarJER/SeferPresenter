import { describe, expect, it } from 'vitest';
import {
  estimateTimelinePositionSec,
  findActiveCueIndex,
  findCueForSlideSelection,
} from '../../server/audio-timeline-sync.mjs';

const syncMap = {
  id: 'map-1',
  presentationId: 'p1',
  audioSrc: '/audio/track.mp3',
  cues: [
    { timeSec: 0, slideIndex: 0 },
    { timeSec: 12, slideIndex: 1 },
    { timeSec: 18, slideIndex: 1, verse: '2' },
    { timeSec: 27, slideIndex: 2 },
  ],
};

describe('audio timeline sync helpers', () => {
  it('estimates backend timeline position while playing', () => {
    expect(estimateTimelinePositionSec({
      status: 'playing',
      basePositionSec: 10,
      baseServerTimeMs: 1_000,
      playbackRate: 1.5,
    }, 3_000)).toBe(13);
  });

  it('finds the active cue for a timeline position', () => {
    expect(findActiveCueIndex(syncMap.cues, -1)).toBe(-1);
    expect(findActiveCueIndex(syncMap.cues, 0)).toBe(0);
    expect(findActiveCueIndex(syncMap.cues, 17.99)).toBe(1);
    expect(findActiveCueIndex(syncMap.cues, 18)).toBe(2);
    expect(findActiveCueIndex(syncMap.cues, 99)).toBe(3);
  });

  it('finds exact verse cues before slide-level fallback', () => {
    expect(findCueForSlideSelection(syncMap, 1, '2')).toEqual({
      cue: { timeSec: 18, slideIndex: 1, verse: '2' },
      index: 2,
    });
    expect(findCueForSlideSelection(syncMap, 1, undefined)).toEqual({
      cue: { timeSec: 12, slideIndex: 1 },
      index: 1,
    });
    expect(findCueForSlideSelection(syncMap, 3, undefined)).toBeNull();
  });
});
