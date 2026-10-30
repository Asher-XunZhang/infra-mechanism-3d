import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PlaybackClock, sampleTimeline } from '../core/timeline';
import type {
  LaneDefinition,
  LaneMode,
  MountedViewer,
  PlaybackState,
  SceneDefinition,
  SceneHandle,
  ScenePlaybackContext,
  ScenarioDefinition,
  ViewerEvent,
  ViewerOptions,
  ViewerState,
} from './types';
import {
  clampIndex,
  getScenario,
  getScene,
  parseLocationHash,
  serializeLocation,
  stateFromLocation,
  switchLaneMode,
  switchScenario,
  switchScene,
  visibleLaneIds,
} from './state';
import { stepDurations, stepStarts } from './timeline';
import { StageView } from './StageView';
import { disposeObject } from './three/toolkit';
import { ViewerApp } from './react/ViewerApp';
import type { ViewerUiController, ViewerUiSnapshot } from './react/types';
import viewerCss from './viewer.css?inline';

type PlaybackStage = StageView & {
  setPlayback?: (context: Omit<ScenePlaybackContext, 'lane' | 'reducedMotion'>) => void;
};

type StageSync = { stepId: string; selected: string | null };

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) {
      return false;
    }
    const lose = (context as WebGLRenderingContext).getExtension(
      'WEBGL_lose_context',
    );
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function optionsKey(options: Record<string, string>): string {
  return Object.keys(options)
    .sort()
    .map((key) => `${key}=${options[key]}`)
    .join('|');
}

function failureKey(sceneId: string, laneId: string): string {
  return `${sceneId}:${laneId}`;
}

function stageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/webgl/i.test(error.message)) {
      return 'WebGL 初始化失败，三维视图不可用。';
    }
    return `三维场景初始化失败：${error.message.slice(0, 160)}`;
  }
  return '三维场景初始化失败，已切换为文本阅读。';
}

export class MechanismViewer implements MountedViewer, ViewerUiController {
  readonly element: HTMLElement;
  private readonly pack: ViewerOptions['pack'];
  private readonly options: ViewerOptions;
  private readonly shadow: ShadowRoot;
  private readonly reactRoot: Root;
  private readonly abort = new AbortController();
  private readonly stageViews = new Map<string, StageView>();
  private readonly stageKeys = new Map<string, string>();
  private readonly stageFailuresValue = new Map<string, string>();
  private readonly stageSync = new Map<string, StageSync>();
  private readonly listeners = new Set<() => void>();
  private readonly boundary: IntersectionObserver;
  private readonly media: MediaQueryList;
  private stateValue: ViewerState;
  private clock: PlaybackClock;
  private snapshot: ViewerUiSnapshot;
  private readonly fallbackOnNoWebGL: boolean;
  private readonly webglSupported: boolean;
  private readonly reducedMotionQuery: boolean;
  private reducedMotion: boolean;
  private inView = true;
  private frameId: number | null = null;
  private lastFrame = 0;
  private lastPublish = 0;
  private disposed = false;

  constructor(container: HTMLElement, options: ViewerOptions) {
    this.pack = options.pack;
    this.options = options;
    if (!this.pack.scenes.length) {
      throw new Error('A viewer pack needs at least one scene.');
    }
    this.fallbackOnNoWebGL = options.fallbackOnNoWebGL !== false;
    this.webglSupported = detectWebGL();
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotionQuery = this.media.matches;
    this.reducedMotion = this.reducedMotionQuery;

    const parsed =
      options.syncHash === false ? {} : parseLocationHash(window.location.hash);
    this.stateValue = stateFromLocation(this.pack, parsed, {
      initialSceneId: options.initialSceneId,
      initialLaneMode: options.initialLaneMode,
      initialOptions: options.initialOptions,
    });
    if (!this.scenario().steps.length) {
      throw new Error('A viewer scenario needs at least one step.');
    }
    this.clock = this.createClock(this.stateValue.stepIndex);
    this.snapshot = this.buildSnapshot();

    this.element = document.createElement('div');
    this.element.className = 'imv-host';
    this.element.tabIndex = 0;
    this.element.dataset.imv = 'host';
    this.shadow = this.element.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = viewerCss;
    const appHost = document.createElement('div');
    appHost.className = 'imv-react-root';
    this.shadow.append(style, appHost);
    this.reactRoot = createRoot(appHost);
    this.reactRoot.render(createElement(ViewerApp, { viewer: this }));

    this.bindEvents();
    this.boundary = new IntersectionObserver(
      (entries) => {
        this.inView = Boolean(entries[0]?.isIntersecting);
        if (!this.inView) {
          this.pauseForVisibility();
        }
      },
      { threshold: 0.04 },
    );

    container.append(this.element);
    this.boundary.observe(this.element);
    this.writeHash();
    this.emit({ type: 'ready' });
  }

  static mount(container: HTMLElement, options: ViewerOptions): MechanismViewer {
    return new MechanismViewer(container, options);
  }

  getSnapshot = (): ViewerUiSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopLoop();
    this.abort.abort();
    this.boundary.disconnect();
    this.clock.destroy();
    this.reactRoot.unmount();
    this.disposeStages();
    this.listeners.clear();
    this.emit({ type: 'destroy' });
    this.element.remove();
  }

  getState(): ViewerState {
    const playback = this.readPlayback();
    return {
      ...this.stateValue,
      stepIndex: playback.stepIndex,
      playing: playback.playing,
    };
  }

  getPlayback(): PlaybackState {
    return this.readPlayback();
  }

  setScene(sceneId: string): void {
    const previous = this.stateValue;
    const next = switchScene(this.pack, previous, sceneId, previous.laneMode);
    this.stateValue = next;
    this.stageFailuresValue.clear();
    this.stageSync.clear();
    this.resetClock(next.stepIndex);
    this.publish();
    if (previous.sceneId !== next.sceneId) {
      this.emit({ type: 'scene-change', sceneId: next.sceneId });
    }
    if (previous.stepIndex !== next.stepIndex) {
      this.emitStepChange();
    }
    this.writeHash();
  }

  setScenario(scenarioId: string): void {
    const previous = this.stateValue;
    const next = switchScenario(this.scene(), previous, scenarioId);
    this.stateValue = next;
    this.resetClock(next.stepIndex);
    this.syncAllStages(true);
    this.publish();
    if (previous.stepIndex !== next.stepIndex) {
      this.emitStepChange();
    }
    this.writeHash();
  }

  setLaneMode(mode: LaneMode): void {
    const previous = this.stateValue;
    const next = switchLaneMode(this.scene(), previous, mode);
    this.stateValue = next;
    this.resetClock(next.stepIndex);
    this.syncAllStages(true);
    this.publish();
    this.writeHash();
  }

  setStep(stepIndex: number): void {
    const scenario = this.scenario();
    if (!scenario.steps.length) {
      return;
    }
    const target = clampIndex(stepIndex, scenario.steps.length);
    const starts = stepStarts(scenario);
    this.clock.seek(starts[target] ?? 0);
    const previous = this.stateValue;
    this.stateValue = {
      ...previous,
      stepIndex: target,
      playing: false,
    };
    this.stopLoop();
    this.syncAllStages(true);
    this.publish();
    if (previous.stepIndex !== target) {
      this.emitStepChange();
    }
    this.writeHash();
  }

  stepBy(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) {
      return;
    }
    this.setStep(this.stateValue.stepIndex + Math.trunc(delta));
  }

  selectModule(moduleId: string | null): void {
    const normalized =
      moduleId && this.pack.modules[moduleId] ? moduleId : null;
    const previous = this.stateValue;
    if (normalized && this.clock.getSnapshot().playing) {
      this.clock.pause();
      this.stopLoop();
    }
    this.stateValue = {
      ...this.stateValue,
      moduleId: normalized,
      playing: this.clock.getSnapshot().playing,
    };
    this.syncAllStages(true);
    this.publish();
    if (previous.moduleId !== normalized) {
      this.emit({ type: 'module-select', moduleId: normalized });
      this.writeHash();
    }
    if (normalized) {
      for (const stage of this.stageViews.values()) {
        stage.focusNode(normalized);
      }
    }
  }

  setOption(optionId: string, value: string): void {
    const scene = this.scene();
    const option = scene.options?.find((candidate) => candidate.id === optionId);
    if (!option || !option.values.some((entry) => entry.id === value)) {
      return;
    }
    if (this.stateValue.options[optionId] === value) {
      return;
    }
    const previous = this.stateValue;
    this.stateValue = {
      ...previous,
      stepIndex: 0,
      playing: false,
      moduleId: null,
      options: { ...previous.options, [optionId]: value },
    };
    this.stageSync.clear();
    this.resetClock(0);
    this.publish();
    if (previous.stepIndex !== 0) {
      this.emitStepChange();
      this.writeHash();
    }
  }

  play(): void {
    if (this.clock.getSnapshot().playing || this.scenario().steps.length < 2) {
      return;
    }
    if (!this.inView || document.hidden) {
      return;
    }
    const previous = this.stateValue;
    this.clock.play();
    const playback = this.readPlayback();
    this.stateValue = {
      ...previous,
      stepIndex: playback.stepIndex,
      playing: true,
    };
    this.startLoop();
    this.syncAllStages(true, playback);
    this.publish();
    if (previous.stepIndex !== playback.stepIndex) {
      this.emitStepChange();
    }
    this.writeHash();
  }

  pause(): void {
    if (!this.clock.getSnapshot().playing && !this.stateValue.playing) {
      return;
    }
    this.clock.pause();
    this.stateValue = { ...this.stateValue, playing: false };
    this.stopLoop();
    this.syncAllStages(true);
    this.publish();
  }

  seek(seconds: number): void {
    this.clock.seek(seconds);
    const playback = this.readPlayback();
    const previous = this.stateValue;
    const stepChanged = previous.stepIndex !== playback.stepIndex;
    this.stateValue = {
      ...previous,
      stepIndex: playback.stepIndex,
      playing: false,
    };
    this.stopLoop();
    this.syncAllStages(true, playback);
    this.publish();
    if (stepChanged) {
      this.emitStepChange();
      this.writeHash();
    }
  }

  seekStep(stepIndex: number): void {
    this.setStep(stepIndex);
  }

  setSpeed(speed: number): void {
    this.clock.setSpeed(speed);
    this.publish();
  }

  resetCamera(): void {
    for (const stage of this.stageViews.values()) {
      stage.resetCamera();
    }
  }

  resetLaneCamera(laneId: string): void {
    this.stageViews.get(laneId)?.resetCamera();
  }

  bindStage(laneId: string, host: HTMLElement): void {
    if (this.disposed) {
      return;
    }
    const lane = this.lanesForView().find((candidate) => candidate.id === laneId);
    if (!lane) {
      return;
    }
    const scene = this.scene();
    const key = `${scene.id}:${lane.id}:${this.reducedMotion}:${optionsKey(this.stateValue.options)}`;
    const existing = this.stageViews.get(laneId);
    if (
      existing &&
      this.stageKeys.get(laneId) === key &&
      existing.root.parentElement === host
    ) {
      this.syncStage(lane, existing, false);
      return;
    }
    if (existing) {
      this.destroyStage(laneId);
    }
    if (!this.webglSupported) {
      return;
    }
    const keyFailure = failureKey(scene.id, lane.id);
    if (this.stageFailuresValue.has(keyFailure)) {
      return;
    }

    let handle: SceneHandle | undefined;
    let stage: StageView | undefined;
    try {
      handle = scene.buildLane({
        lane,
        scene,
        laneIndex: scene.lanes.findIndex((candidate) => candidate.id === lane.id),
        laneCount: this.lanesForView().length,
        reducedMotion: this.reducedMotion,
        options: { ...this.stateValue.options },
      });
      stage = new StageView(host, {
        lane,
        handle,
        reducedMotion: this.reducedMotion,
        onCameraChange: (pose) => {
          for (const [otherId, other] of this.stageViews) {
            if (otherId !== lane.id) {
              other.setCameraPose(pose);
            }
          }
        },
        onSelect: (nodeId) => this.selectModule(nodeId),
      });
      this.stageViews.set(lane.id, stage);
      this.stageKeys.set(lane.id, key);
      this.syncStage(lane, stage, true);
      if (this.stateValue.moduleId) {
        stage.focusNode(this.stateValue.moduleId);
      }
    } catch (error) {
      if (stage) {
        stage.dispose();
      } else {
        try {
          handle?.dispose();
          if (handle) {
            disposeObject(handle.scene);
          }
        } catch {
          // The failed scene may already be partially disposed.
        }
      }
      host.replaceChildren();
      this.stageFailuresValue.set(keyFailure, stageErrorMessage(error));
      this.publish();
    }
  }

  unbindStage(laneId: string, host: HTMLElement): void {
    const stage = this.stageViews.get(laneId);
    if (!stage) {
      return;
    }
    if (stage.root.parentElement === host || !stage.root.isConnected) {
      this.destroyStage(laneId);
    }
  }

  private bindEvents(): void {
    const signal = this.abort.signal;
    this.element.addEventListener('keydown', this.handleKeydown, { signal });
    document.addEventListener('visibilitychange', this.handleVisibility, {
      signal,
    });
    window.addEventListener('hashchange', this.handleHashChange, { signal });
    this.media.addEventListener('change', this.handleMotionChange, { signal });
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const target = event.composedPath()[0];
    if (
      target instanceof Element &&
      target.closest(
        'button, a[href], input, textarea, select, [contenteditable="true"]',
      )
    ) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.stepBy(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.stepBy(-1);
    } else if (event.key === ' ') {
      if (event.repeat) {
        return;
      }
      event.preventDefault();
      if (this.clock.getSnapshot().playing) {
        this.pause();
      } else {
        this.play();
      }
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.setStep(0);
    } else if (event.key.toLowerCase() === 'c') {
      event.preventDefault();
      this.resetCamera();
    }
  };

  private handleVisibility = (): void => {
    if (document.hidden) {
      this.pauseForVisibility();
    }
  };

  private handleHashChange = (): void => {
    if (this.options.syncHash === false || this.disposed) {
      return;
    }
    const previous = this.stateValue;
    const next = stateFromLocation(
      this.pack,
      parseLocationHash(window.location.hash),
      {
        initialSceneId: this.options.initialSceneId,
        initialLaneMode: this.options.initialLaneMode,
        initialOptions: this.options.initialOptions,
      },
    );
    this.stateValue = next;
    if (previous.sceneId !== next.sceneId) {
      this.stageFailuresValue.clear();
      this.stageSync.clear();
    }
    this.resetClock(next.stepIndex);
    if (previous.sceneId === next.sceneId) {
      this.syncAllStages(true);
    }
    this.publish();
    if (previous.sceneId !== next.sceneId) {
      this.emit({ type: 'scene-change', sceneId: next.sceneId });
    }
    if (previous.stepIndex !== next.stepIndex) {
      this.emitStepChange();
    }
    if (previous.moduleId !== next.moduleId) {
      this.emit({ type: 'module-select', moduleId: next.moduleId });
    }
  };

  private handleMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    if (this.reducedMotion) {
      this.pauseForVisibility();
    }
    this.publish();
  };

  private pauseForVisibility(): void {
    if (this.clock.getSnapshot().playing) {
      this.pause();
    }
  }

  private createClock(stepIndex: number, speed = 1): PlaybackClock {
    const scenario = this.scenario();
    const clock = new PlaybackClock(stepDurations(scenario));
    clock.setSpeed(speed);
    const starts = stepStarts(scenario);
    clock.seek(starts[clampIndex(stepIndex, scenario.steps.length)] ?? 0);
    return clock;
  }

  private resetClock(stepIndex: number): void {
    const speed = this.clock?.getSnapshot().speed ?? 1;
    this.clock?.destroy();
    this.stopLoop();
    this.clock = this.createClock(stepIndex, speed);
  }

  private readPlayback(): PlaybackState {
    const snapshot = this.clock.getSnapshot();
    const scenario = this.scenario();
    const sample = sampleTimeline(stepDurations(scenario), snapshot.time);
    return {
      time: snapshot.time,
      duration: snapshot.duration,
      playing: snapshot.playing,
      speed: snapshot.speed,
      stepIndex: sample.index,
      progress: sample.progress,
      done: sample.done,
    };
  }

  private buildSnapshot(
    playback: PlaybackState = this.readPlayback(),
  ): ViewerUiSnapshot {
    const scene = this.scene();
    const scenario = this.scenario();
    const targetStep = scenario.steps[playback.stepIndex] ?? scenario.steps[0];
    const confirmedStep = scenario.steps[Math.max(0, playback.stepIndex - 1)] ?? targetStep;
    // Captions describe the current action; assertions must not announce its
    // after-state while geometry is still in transit.
    const displayStep = playback.progress < 1 && targetStep.laneFacts
      ? {
          ...targetStep,
          laneFacts: Object.fromEntries(Object.entries(targetStep.laneFacts).map(([id, fact]) => [id, fact.tone === 'blocked' ? fact : {
            ...fact,
            tone: 'neutral' as const,
            status: `进行中 · ${targetStep.label}`,
            detail: `已确认状态：${confirmedStep.laneFacts?.[id]?.detail ?? this.scene().lanes.find(lane => lane.id === id)?.status ?? ''}`,
          }])),
        }
      : targetStep;
    const failures: Record<string, string> = {};
    for (const [key, value] of this.stageFailuresValue) {
      failures[key] = value;
    }
    return Object.freeze({
      pack: this.pack,
      state: Object.freeze({
        ...this.stateValue,
        stepIndex: playback.stepIndex,
        playing: playback.playing,
      }),
      scene,
      scenario,
      step: displayStep,
      stepCount: scenario.steps.length,
      playback: Object.freeze(playback),
      reducedMotion: this.reducedMotion,
      webglSupported: this.webglSupported,
      fallbackOnNoWebGL: this.fallbackOnNoWebGL,
      stageFailures: Object.freeze(failures),
      optionsKey: optionsKey(this.stateValue.options),
    });
  }

  private publish(): void {
    if (this.disposed) {
      return;
    }
    const playback = this.readPlayback();
    this.stateValue = {
      ...this.stateValue,
      stepIndex: playback.stepIndex,
      playing: playback.playing,
    };
    this.snapshot = this.buildSnapshot(playback);
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A consumer render error must not stop the reading clock.
      }
    }
  }

  private startLoop(): void {
    if (this.frameId !== null || this.disposed) {
      return;
    }
    this.lastFrame = performance.now();
    this.lastPublish = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private tick = (now: number): void => {
    this.frameId = null;
    if (this.disposed || !this.clock.getSnapshot().playing) {
      return;
    }
    if (document.hidden || !this.inView) {
      this.pauseForVisibility();
      return;
    }
    const delta = Math.min(0.25, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.clock.advance(delta);
    const playback = this.readPlayback();
    const previousStep = this.stateValue.stepIndex;
    this.stateValue = {
      ...this.stateValue,
      stepIndex: playback.stepIndex,
      playing: playback.playing,
    };
    if (previousStep !== playback.stepIndex) {
      this.emitStepChange();
      this.writeHash();
    }
    this.syncAllStages(false, playback);
    if (
      now - this.lastPublish >= 90 ||
      previousStep !== playback.stepIndex ||
      !playback.playing
    ) {
      this.lastPublish = now;
      this.publish();
    }
    if (playback.playing) {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private syncAllStages(force = false, playback = this.readPlayback()): void {
    const lanes = new Map(
      this.lanesForView().map((lane) => [lane.id, lane] as const),
    );
    for (const [laneId, stage] of this.stageViews) {
      const lane = lanes.get(laneId);
      if (lane) {
        this.syncStage(lane, stage, force, playback);
      }
    }
  }

  private syncStage(
    lane: LaneDefinition,
    stage: StageView,
    force: boolean,
    playback = this.readPlayback(),
  ): void {
    const scenario = this.scenario();
    const step = scenario.steps[playback.stepIndex] ?? scenario.steps[0];
    if (!step) {
      return;
    }
    const previousStep =
      scenario.steps[Math.max(0, playback.stepIndex - 1)] ?? step;
    const context: Omit<ScenePlaybackContext, 'lane' | 'reducedMotion'> = {
      scenario,
      step,
      stepIndex: playback.stepIndex,
      stepCount: scenario.steps.length,
      previousStep,
      progress: playback.progress,
      time: playback.time,
      playing: playback.playing,
      options: this.stateValue.options,
    };
    const playbackStage = stage as PlaybackStage;
    const sync = this.stageSync.get(lane.id);
    if (typeof playbackStage.setPlayback === 'function') {
      playbackStage.setPlayback(context);
    } else if (force || !sync || sync.stepId !== step.id) {
      stage.setStep({
        scenario,
        step,
        stepIndex: playback.stepIndex,
        stepCount: scenario.steps.length,
      });
    }
    if (force || !sync || sync.stepId !== step.id) {
      stage.setActiveNodes(step.moduleIds);
    }
    if (force || !sync || sync.selected !== this.stateValue.moduleId) {
      stage.setSelected(this.stateValue.moduleId);
    }
    this.stageSync.set(lane.id, {
      stepId: step.id,
      selected: this.stateValue.moduleId,
    });
  }

  private destroyStage(laneId: string): void {
    const stage = this.stageViews.get(laneId);
    if (stage) {
      stage.dispose();
    }
    this.stageViews.delete(laneId);
    this.stageKeys.delete(laneId);
    this.stageSync.delete(laneId);
  }

  private disposeStages(): void {
    for (const laneId of [...this.stageViews.keys()]) {
      this.destroyStage(laneId);
    }
    this.stageSync.clear();
  }

  private emitStepChange(): void {
    this.emit({
      type: 'step-change',
      stepIndex: this.stateValue.stepIndex,
      stepId: this.scenario().steps[this.stateValue.stepIndex]?.id ?? '',
    });
  }

  private writeHash(): void {
    if (this.options.syncHash === false || this.disposed) {
      return;
    }
    const next = serializeLocation(this.pack, this.stateValue);
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }

  private emit(event: ViewerEvent): void {
    if (this.disposed && event.type !== 'destroy') {
      return;
    }
    try {
      this.options.onEvent?.(event);
    } catch {
      // Consumer callbacks must not break the viewer lifecycle.
    }
  }

  private scene(): SceneDefinition {
    return getScene(this.pack, this.stateValue.sceneId);
  }

  private scenario(): ScenarioDefinition {
    return getScenario(this.scene(), this.stateValue.scenarioId);
  }

  private lanesForView(): LaneDefinition[] {
    const scene = this.scene();
    return visibleLaneIds(scene, this.stateValue.laneMode)
      .map((id) => scene.lanes.find((lane) => lane.id === id))
      .filter((lane): lane is LaneDefinition => Boolean(lane));
  }
}

export function mountViewer(
  container: HTMLElement,
  options: ViewerOptions,
): MechanismViewer {
  return MechanismViewer.mount(container, options);
}
