import type { ScenarioDefinition, ViewerStep } from './types';

/** Teaching seconds. Every scene declares its reading duration in content. */
export const DEFAULT_STEP_DURATION = 2.8;

export function durationForStep(step: ViewerStep): number {
  return step.duration && Number.isFinite(step.duration) && step.duration > 0
    ? step.duration
    : DEFAULT_STEP_DURATION;
}

export function stepDurations(scenario: ScenarioDefinition): number[] {
  return scenario.steps.map(durationForStep);
}

export function stepStarts(scenario: ScenarioDefinition): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const duration of stepDurations(scenario)) {
    starts.push(cursor);
    cursor += duration;
  }
  return starts;
}

export function scenarioDuration(scenario: ScenarioDefinition): number {
  return stepDurations(scenario).reduce((sum, duration) => sum + duration, 0);
}

export function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(duration, value));
}

/** Symmetric easing; final position is always exactly the target. */
export function easeInOutCubic(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function formatReadingTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const tenths = Math.floor((safe - whole) * 10);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(
    whole % 60,
  ).padStart(2, '0')}.${tenths}`;
}
