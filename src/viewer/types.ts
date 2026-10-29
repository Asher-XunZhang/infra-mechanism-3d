import type * as THREE from 'three';

export type Accent = 'cyan' | 'amber' | 'coral' | 'lilac' | 'mint' | 'rose';

export interface SourceAnchor {
  id: string;
  label: string;
  repository: string;
  commit: string;
  path: string;
  startLine: number;
  endLine?: number;
  symbol: string;
  note?: string;
}

export interface Provenance {
  repository: string;
  commit: string;
  shortCommit: string;
  label: string;
  scope: string;
  reviewed?: string;
}

export interface ModuleDoc {
  id: string;
  title: string;
  name: string;
  directory: string;
  groupId: string;
  accent: Accent;
  summary: string;
  why: string;
  action: string;
  objects: string[];
  boundaries: string[];
  sourceIds: string[];
}

export interface ProcessGroup {
  id: string;
  label: string;
  kind: 'process' | 'device';
  detail: string;
}

export interface LaneDefinition {
  id: string;
  label: string;
  version: string;
  commit: string;
  shortCommit: string;
  status: string;
  note: string;
  available: boolean;
  accent: Accent;
}

export type LaneFactTone = 'available' | 'blocked' | 'halted' | 'neutral' | 'assumed' | 'changed';

export interface LaneFact {
  status: string;
  tone: LaneFactTone;
  detail: string;
}

export interface Condition {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'assumed' | 'skipped';
  detail: string;
  sourceIds?: string[];
}

export interface ChangeEntry {
  moduleId: string;
  label: string;
  oldState: string;
  newState: string;
  tone: 'added' | 'changed' | 'guarded';
}

export interface ViewerStep {
  id: string;
  label: string;
  title: string;
  summary: string;
  points?: string[];
  moduleIds: string[];
  sourceIds?: string[];
  laneFacts?: Record<string, LaneFact>;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  summary: string;
  steps: ViewerStep[];
  conditions?: Condition[];
  changes?: ChangeEntry[];
  note?: string;
}

export interface SceneDefinition {
  id: string;
  navLabel: string;
  title: string;
  kicker: string;
  description: string;
  mode: 'explore' | 'guided' | 'compare';
  provenance: Provenance;
  lanes: LaneDefinition[];
  scenarios: ScenarioDefinition[];
  instructions?: string;
  buildLane: (args: SceneBuildArgs) => SceneHandle;
}

export interface ViewerPack {
  id: string;
  title: string;
  subtitle: string;
  context: string;
  summary: string;
  repository: string;
  reviewDate: string;
  modules: Record<string, ModuleDoc>;
  groups: ProcessGroup[];
  sourceAnchors: Record<string, SourceAnchor>;
  scenes: SceneDefinition[];
  notes: string[];
}

export interface SceneBuildArgs {
  lane: LaneDefinition;
  scene: SceneDefinition;
  laneIndex: number;
  laneCount: number;
  reducedMotion: boolean;
}

export interface FocusPoint {
  target: THREE.Vector3;
  position: THREE.Vector3;
}

export interface OverlayLabelSpec {
  id: string;
  text: string;
  meta?: string;
  nodeId?: string;
  kind?: 'node' | 'state' | 'process';
  anchor: THREE.Vector3 | (() => THREE.Vector3);
  visible?: boolean;
}

export interface StepRenderContext {
  scenario: ScenarioDefinition;
  step: ViewerStep;
  stepIndex: number;
  stepCount: number;
  lane: LaneDefinition;
  reducedMotion: boolean;
}

export interface SceneHandle {
  scene: THREE.Scene;
  labels: OverlayLabelSpec[];
  focus: Record<string, FocusPoint>;
  home: FocusPoint;
  setStep: (context: StepRenderContext) => void;
  setSelected: (nodeId: string | null) => void;
  setHovered?: (nodeId: string | null) => void;
  update: (deltaSeconds: number) => boolean;
  dispose: () => void;
}

export interface ViewerOptions {
  pack: ViewerPack;
  initialSceneId?: string;
  initialLaneMode?: LaneMode;
  syncHash?: boolean;
  fallbackOnNoWebGL?: boolean;
  onEvent?: (event: ViewerEvent) => void;
}

export type ViewerEvent =
  | { type: 'ready' }
  | { type: 'scene-change'; sceneId: string }
  | { type: 'step-change'; stepIndex: number; stepId: string }
  | { type: 'module-select'; moduleId: string | null }
  | { type: 'destroy' };

export type LaneMode = 'both' | 'left' | 'right';

export interface ViewerState {
  sceneId: string;
  scenarioId: string;
  laneMode: LaneMode;
  stepIndex: number;
  moduleId: string | null;
  playing: boolean;
}

export interface ParsedLocation {
  sceneId?: string;
  scenarioId?: string;
  laneMode?: LaneMode;
  stepIndex?: number;
  moduleId?: string | null;
}

export interface MountedViewer {
  element: HTMLElement;
  destroy: () => void;
  getState: () => ViewerState;
  setScene: (sceneId: string) => void;
  setScenario: (scenarioId: string) => void;
  setLaneMode: (mode: LaneMode) => void;
  setStep: (stepIndex: number) => void;
  selectModule: (moduleId: string | null) => void;
  resetCamera: () => void;
}
