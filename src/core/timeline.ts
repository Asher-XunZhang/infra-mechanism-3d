/** Reading time, never measured inference time. No DOM, RAF, or renderer dependency. */
export interface PlaybackSnapshot {
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly speed: number;
}

export function sampleTimeline(durations: readonly number[], requestedTime: number) {
  if (!durations.length || durations.some(d => !Number.isFinite(d) || d <= 0)) {
    throw new Error('A timeline needs finite positive event durations');
  }
  const duration = durations.reduce((sum, d) => sum + d, 0);
  const time = Math.max(0, Math.min(duration, Number.isFinite(requestedTime) ? requestedTime : 0));
  let start = 0;
  for (let index = 0; index < durations.length; index++) {
    const end = start + durations[index];
    if (time < end || index === durations.length - 1) {
      return { index, progress: Math.min(1, (time - start) / durations[index]), start, end, time, done: time === duration };
    }
    start = end;
  }
  throw new Error('Unreachable timeline position');
}

export class PlaybackClock {
  private readonly durations: readonly number[];
  private value: PlaybackSnapshot;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(durations: readonly number[]) {
    sampleTimeline(durations, 0);
    this.durations = [...durations];
    this.value = Object.freeze({ time: 0, duration: durations.reduce((a, b) => a + b, 0), playing: false, speed: 1 });
  }
  getSnapshot = (): PlaybackSnapshot => this.value;
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private change(patch: Partial<PlaybackSnapshot>): void {
    if (this.disposed) return;
    const next = { ...this.value, ...patch };
    if (next.time === this.value.time && next.playing === this.value.playing && next.speed === this.value.speed) return;
    this.value = Object.freeze(next);
    this.listeners.forEach(listener => listener());
  }
  play(): void {
    this.change({ playing: true, time: this.value.time >= this.value.duration ? 0 : this.value.time });
  }
  pause(): void { this.change({ playing: false }); }
  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.change({ time: Math.max(0, Math.min(this.value.duration, seconds)), playing: false });
  }
  seekStep(index: number): void {
    if (!Number.isFinite(index)) return;
    const target = Math.max(0, Math.min(this.durations.length - 1, Math.trunc(index)));
    this.seek(this.durations.slice(0, target).reduce((a, b) => a + b, 0));
  }
  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.change({ speed: Math.max(0.1, Math.min(4, speed)) });
  }
  advance(deltaSeconds: number): void {
    if (!this.value.playing || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    const time = Math.min(this.value.duration, this.value.time + deltaSeconds * this.value.speed);
    this.change({ time, playing: time < this.value.duration });
  }
  destroy(): void { this.pause(); this.listeners.clear(); this.disposed = true; }
}
