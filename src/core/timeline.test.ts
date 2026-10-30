import { describe, expect, it } from 'vitest';
import { PlaybackClock, sampleTimeline } from './timeline';

describe('continuous reading clock', () => {
  it('freezes the precise transition position while paused and resumes from it', () => {
    const clock = new PlaybackClock([2, 3]);
    clock.play(); clock.advance(0.7); clock.pause();
    const paused = clock.getSnapshot();
    clock.advance(20);
    expect(clock.getSnapshot()).toBe(paused);
    expect(sampleTimeline([2, 3], paused.time).progress).toBeCloseTo(0.35);
    clock.play(); clock.advance(0.3);
    expect(clock.getSnapshot().time).toBeCloseTo(1);
  });
  it('reconstructs time independently of frame subdivision and playback history', () => {
    const a = new PlaybackClock([2, 3]), b = new PlaybackClock([2, 3]);
    a.setSpeed(2); b.setSpeed(2); a.play(); b.play();
    a.advance(1.5);
    for (let i = 0; i < 15; i++) b.advance(0.1);
    expect(a.getSnapshot().time).toBeCloseTo(b.getSnapshot().time);
    a.seek(0.6); const at = sampleTimeline([2, 3], a.getSnapshot().time);
    a.seek(4.9); a.seek(0.6);
    expect(sampleTimeline([2, 3], a.getSnapshot().time)).toEqual(at);
  });
  it('holds stable snapshots, clamps endpoints, and cleans subscriptions', () => {
    const clock = new PlaybackClock([1, 1]); let count = 0;
    const unsubscribe = clock.subscribe(() => count++);
    expect(clock.getSnapshot()).toBe(clock.getSnapshot());
    clock.play(); clock.advance(10);
    expect(clock.getSnapshot()).toMatchObject({ time: 2, playing: false });
    expect(sampleTimeline([1, 1], 2)).toMatchObject({ index: 1, progress: 1, done: true });
    unsubscribe(); const old = count; clock.seek(-2); expect(count).toBe(old);
    clock.destroy(); clock.play(); expect(clock.getSnapshot().playing).toBe(false);
  });
});
