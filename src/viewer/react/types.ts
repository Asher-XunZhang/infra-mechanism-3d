import type {
  LaneMode,
  PlaybackState,
  SceneDefinition,
  ScenarioDefinition,
  ViewerPack,
  ViewerState,
  ViewerStep,
} from '../types';

/** Immutable UI snapshot published by the mounted viewer. */
export interface ViewerUiSnapshot {
  readonly pack: ViewerPack;
  readonly state: ViewerState;
  readonly scene: SceneDefinition;
  readonly scenario: ScenarioDefinition;
  readonly step: ViewerStep;
  readonly stepCount: number;
  readonly playback: PlaybackState;
  readonly reducedMotion: boolean;
  readonly webglSupported: boolean;
  readonly fallbackOnNoWebGL: boolean;
  /** Scene/lane key to a human-readable reason when that 3D stage failed. */
  readonly stageFailures: Readonly<Record<string, string>>;
  readonly optionsKey: string;
}

/**
 * The imperative controller consumed by the React shell. The Three.js
 * StageViews deliberately stay outside React state.
 */
export interface ViewerUiController {
  getSnapshot: () => ViewerUiSnapshot;
  subscribe: (listener: () => void) => () => void;
  setScene: (sceneId: string) => void;
  setScenario: (scenarioId: string) => void;
  setLaneMode: (mode: LaneMode) => void;
  setStep: (stepIndex: number) => void;
  stepBy: (delta: number) => void;
  selectModule: (moduleId: string | null) => void;
  setOption: (optionId: string, value: string) => void;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  setSpeed: (speed: number) => void;
  resetCamera: () => void;
  resetLaneCamera: (laneId: string) => void;
  bindStage: (laneId: string, host: HTMLElement) => void;
  unbindStage: (laneId: string, host: HTMLElement) => void;
}
