import type {
  LaneMode,
  ParsedLocation,
  ScenarioDefinition,
  SceneDefinition,
  ViewerPack,
  ViewerState,
} from './types';

const LANE_MODES: LaneMode[] = ['both', 'left', 'right'];

export function getScene(pack: ViewerPack, sceneId: string): SceneDefinition {
  const scene = pack.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`Unknown scene: ${sceneId}`);
  }
  return scene;
}

export function getScenario(
  scene: SceneDefinition,
  scenarioId: string,
): ScenarioDefinition {
  const scenario = scene.scenarios.find((candidate) => candidate.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario "${scenarioId}" in scene "${scene.id}"`);
  }
  return scenario;
}

export function getScenarioSafe(
  scene: SceneDefinition,
  scenarioId: string | undefined,
): ScenarioDefinition {
  return (
    scene.scenarios.find((candidate) => candidate.id === scenarioId) ??
    scene.scenarios[0]
  );
}

export function laneModeForScene(scene: SceneDefinition, requested?: LaneMode): LaneMode {
  if (scene.lanes.length < 2) {
    return 'both';
  }
  return requested && LANE_MODES.includes(requested) ? requested : 'both';
}

export function initialState(
  pack: ViewerPack,
  options: {
    initialSceneId?: string;
    initialLaneMode?: LaneMode;
    sceneId?: string;
    scenarioId?: string;
    stepIndex?: number;
    moduleId?: string | null;
    laneMode?: LaneMode;
  } = {},
): ViewerState {
  const requestedScene =
    options.sceneId ??
    options.initialSceneId ??
    pack.scenes[0]?.id;
  const scene =
    pack.scenes.find((candidate) => candidate.id === requestedScene) ?? pack.scenes[0];
  if (!scene) {
    throw new Error('A viewer pack needs at least one scene.');
  }
  const scenario = getScenarioSafe(scene, options.scenarioId);
  const stepCount = scenario.steps.length;
  const requestedStep = options.stepIndex ?? 0;
  const moduleId =
    options.moduleId && pack.modules[options.moduleId] ? options.moduleId : null;
  return {
    sceneId: scene.id,
    scenarioId: scenario.id,
    laneMode: laneModeForScene(
      scene,
      options.laneMode ?? options.initialLaneMode,
    ),
    stepIndex: clampIndex(requestedStep, stepCount),
    moduleId,
    playing: false,
  };
}

export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.trunc(index), count - 1));
}

export function switchScene(
  pack: ViewerPack,
  state: ViewerState,
  sceneId: string,
  preferredLaneMode?: LaneMode,
): ViewerState {
  const scene = getScene(pack, sceneId);
  const scenario = scene.scenarios[0];
  return {
    ...state,
    sceneId: scene.id,
    scenarioId: scenario.id,
    laneMode: laneModeForScene(scene, preferredLaneMode),
    stepIndex: 0,
    moduleId: null,
    playing: false,
  };
}

export function switchScenario(
  scene: SceneDefinition,
  state: ViewerState,
  scenarioId: string,
): ViewerState {
  const scenario = getScenario(scene, scenarioId);
  return {
    ...state,
    scenarioId: scenario.id,
    stepIndex: 0,
    moduleId: null,
    playing: false,
  };
}

export function switchLaneMode(
  scene: SceneDefinition,
  state: ViewerState,
  laneMode: LaneMode,
): ViewerState {
  return {
    ...state,
    laneMode: laneModeForScene(scene, laneMode),
    stepIndex: 0,
    moduleId: null,
    playing: false,
  };
}

export function stepForward(
  scenario: ScenarioDefinition,
  state: ViewerState,
): ViewerState {
  const next = clampIndex(state.stepIndex + 1, scenario.steps.length);
  return {
    ...state,
    stepIndex: next,
    moduleId: null,
    playing: next > state.stepIndex ? state.playing : false,
  };
}

export function stepBackward(
  scenario: ScenarioDefinition,
  state: ViewerState,
): ViewerState {
  return {
    ...state,
    stepIndex: clampIndex(state.stepIndex - 1, scenario.steps.length),
    moduleId: null,
    playing: false,
  };
}

export function setStep(
  scenario: ScenarioDefinition,
  state: ViewerState,
  stepIndex: number,
): ViewerState {
  return {
    ...state,
    stepIndex: clampIndex(stepIndex, scenario.steps.length),
    moduleId: null,
    playing: false,
  };
}

export function resetSteps(_scenario: ScenarioDefinition, state: ViewerState): ViewerState {
  return {
    ...state,
    stepIndex: 0,
    moduleId: null,
    playing: false,
  };
}

export function togglePlayback(
  scenario: ScenarioDefinition,
  state: ViewerState,
): ViewerState {
  if (state.playing) {
    return { ...state, playing: false };
  }
  if (scenario.steps.length < 2) {
    return { ...state, playing: false };
  }
  return {
    ...state,
    playing: true,
    moduleId: null,
    stepIndex:
      state.stepIndex >= scenario.steps.length - 1 ? 0 : state.stepIndex,
  };
}

export function pausePlayback(state: ViewerState): ViewerState {
  return { ...state, playing: false };
}

export function advancePlayback(
  scenario: ScenarioDefinition,
  state: ViewerState,
): ViewerState {
  if (!state.playing) {
    return state;
  }
  const next = state.stepIndex + 1;
  if (next >= scenario.steps.length) {
    return { ...state, playing: false };
  }
  return { ...state, stepIndex: next, moduleId: null };
}

export function selectModule(state: ViewerState, moduleId: string | null): ViewerState {
  return { ...state, moduleId };
}

export function parseLocationHash(hash: string): ParsedLocation {
  const source = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!source) {
    return {};
  }
  const params = new URLSearchParams(source);
  const sceneId = params.get('scene') ?? undefined;
  const scenarioId = params.get('case') ?? undefined;
  const lane = params.get('lanes');
  const laneMode = lane && LANE_MODES.includes(lane as LaneMode)
    ? (lane as LaneMode)
    : undefined;
  const stepRaw = params.get('step');
  const parsedStep = stepRaw === null ? undefined : Number.parseInt(stepRaw, 10);
  const stepIndex =
    parsedStep !== undefined && Number.isFinite(parsedStep) ? parsedStep : undefined;
  const moduleId = params.has('node') ? params.get('node') : undefined;
  return {
    sceneId,
    scenarioId,
    laneMode,
    stepIndex,
    moduleId,
  };
}

export function stateFromLocation(
  pack: ViewerPack,
  parsed: ParsedLocation,
  options: { initialSceneId?: string; initialLaneMode?: LaneMode } = {},
): ViewerState {
  return initialState(pack, {
    initialSceneId: options.initialSceneId,
    initialLaneMode: options.initialLaneMode,
    sceneId: parsed.sceneId,
    scenarioId: parsed.scenarioId,
    stepIndex: parsed.stepIndex,
    moduleId: parsed.moduleId,
    laneMode: parsed.laneMode,
  });
}

export function serializeLocation(
  pack: ViewerPack,
  state: ViewerState,
): string {
  const scene = getScene(pack, state.sceneId);
  const scenario = getScenario(scene, state.scenarioId);
  const params = new URLSearchParams();
  params.set('scene', scene.id);
  if (scene.scenarios.length > 1) {
    params.set('case', scenario.id);
  }
  params.set('step', String(state.stepIndex));
  if (scene.lanes.length > 1 && state.laneMode !== 'both') {
    params.set('lanes', state.laneMode);
  }
  if (state.moduleId) {
    params.set('node', state.moduleId);
  }
  return `#${params.toString()}`;
}

export function visibleLaneIds(scene: SceneDefinition, mode: LaneMode): string[] {
  if (scene.lanes.length < 2) {
    return [scene.lanes[0].id];
  }
  if (mode === 'left') {
    return [scene.lanes[0].id];
  }
  if (mode === 'right') {
    return [scene.lanes[1].id];
  }
  return scene.lanes.map((lane) => lane.id);
}

export function sourceUrl(source: {
  repository: string;
  commit: string;
  path: string;
  startLine: number;
  endLine?: number;
}): string {
  const range = source.endLine
    ? `#L${source.startLine}-L${source.endLine}`
    : `#L${source.startLine}`;
  return `${source.repository}/blob/${source.commit}/${source.path}${range}`;
}

export function moduleIdsForScene(scene: SceneDefinition): string[] {
  const ids = new Set<string>();
  for (const scenario of scene.scenarios) {
    for (const step of scenario.steps) {
      for (const moduleId of step.moduleIds) {
        ids.add(moduleId);
      }
    }
  }
  return [...ids];
}
