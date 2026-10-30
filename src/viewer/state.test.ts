import { describe, expect, it } from 'vitest';
import type {
  ScenarioDefinition,
  SceneDefinition,
  ViewerPack,
  ViewerState,
} from './types';
import {
  advancePlayback,
  clampIndex,
  parseLocationHash,
  serializeLocation,
  stateFromLocation,
  stepBackward,
  stepForward,
  switchLaneMode,
  switchScenario,
  togglePlayback,
  visibleLaneIds,
} from './state';

const steps = Array.from({ length: 4 }, (_, index) => ({
  id: `step-${index}`,
  label: `Step ${index}`,
  title: `Step ${index}`,
  summary: '',
  moduleIds: ['mod'],
}));

const scenario: ScenarioDefinition = {
  id: 'main',
  label: 'Main',
  summary: '',
  steps,
};

const scene: SceneDefinition = {
  id: 'scene',
  navLabel: 'Scene',
  title: 'Scene',
  kicker: '',
  description: '',
  mode: 'guided',
  provenance: {
    repository: 'https://example.com/repo',
    commit: 'a'.repeat(40),
    shortCommit: 'aaaaaaaaaa',
    label: '',
    scope: '',
  },
  lanes: [
    {
      id: 'left',
      label: 'Left',
      version: 'old',
      commit: '1'.repeat(40),
      shortCommit: '1111111111',
      status: '',
      note: '',
      available: false,
      accent: 'rose',
    },
    {
      id: 'right',
      label: 'Right',
      version: 'new',
      commit: '2'.repeat(40),
      shortCommit: '2222222222',
      status: '',
      note: '',
      available: true,
      accent: 'mint',
    },
  ],
  scenarios: [
    scenario,
    { ...scenario, id: 'other', label: 'Other' },
  ],
  buildLane: () => {
    throw new Error('unused in state tests');
  },
};

const pack: ViewerPack = {
  id: 'test',
  title: 'Test',
  subtitle: '',
  context: '',
  summary: '',
  repository: 'https://example.com/repo',
  reviewDate: '2026-10-29',
  modules: {
    mod: {
      id: 'mod',
      title: 'Mod',
      name: 'Mod',
      directory: 'mods',
      groupId: 'process',
      accent: 'cyan',
      summary: '',
      why: '',
      action: '',
      objects: [],
      boundaries: [],
      sourceIds: [],
    },
  },
  groups: [],
  sourceAnchors: {},
  scenes: [scene],
  notes: [],
};

const baseState: ViewerState = {
  sceneId: 'scene',
  scenarioId: 'main',
  laneMode: 'both',
  stepIndex: 0,
  moduleId: null,
  playing: false,
  options: {},
};

describe('viewer state machine', () => {
  it('clamps navigation to the scenario length', () => {
    expect(clampIndex(-4, 4)).toBe(0);
    expect(clampIndex(99, 4)).toBe(3);
    expect(clampIndex(Number.NaN, 4)).toBe(0);
  });

  it('resets step and playback when scenario or lane changes', () => {
    const advanced: ViewerState = {
      ...baseState,
      stepIndex: 3,
      playing: true,
      moduleId: 'mod',
    };
    expect(switchScenario(scene, advanced, 'main')).toMatchObject({
      stepIndex: 0,
      playing: false,
      moduleId: null,
    });
    expect(switchLaneMode(scene, advanced, 'right')).toMatchObject({
      stepIndex: 0,
      playing: false,
      moduleId: null,
      laneMode: 'right',
    });
  });

  it('advances, rewinds and stops at the final step', () => {
    const atOne = stepForward(scenario, { ...baseState, stepIndex: 1, playing: true });
    expect(atOne.stepIndex).toBe(2);
    expect(stepBackward(scenario, atOne).stepIndex).toBe(1);
    const atEnd = advancePlayback(scenario, {
      ...baseState,
      stepIndex: 3,
      playing: true,
    });
    expect(atEnd.stepIndex).toBe(3);
    expect(atEnd.playing).toBe(false);
  });

  it('restarts playback from the end instead of running past it', () => {
    const toggled = togglePlayback(scenario, { ...baseState, stepIndex: 3 });
    expect(toggled.stepIndex).toBe(0);
    expect(toggled.playing).toBe(true);
    const stopped = togglePlayback(scenario, { ...toggled, playing: true });
    expect(stopped.playing).toBe(false);
  });

  it('round-trips scene, scenario, step, lane and node in a hash', () => {
    const state: ViewerState = {
      ...baseState,
      scenarioId: 'other',
      laneMode: 'right',
      stepIndex: 2,
      moduleId: 'mod',
    };
    const hash = serializeLocation(pack, state);
    const parsed = parseLocationHash(hash);
    const restored = stateFromLocation(pack, parsed);
    expect(restored).toMatchObject({
      sceneId: 'scene',
      scenarioId: 'other',
      laneMode: 'right',
      stepIndex: 2,
      moduleId: 'mod',
      playing: false,
    });
  });

  it('falls back safely for unknown hash values', () => {
    const restored = stateFromLocation(pack, parseLocationHash('#scene=nope&step=999&case=nope&lanes=nope&node=nope'));
    expect(restored).toMatchObject({
      sceneId: 'scene',
      scenarioId: 'main',
      laneMode: 'both',
      stepIndex: 3,
      moduleId: null,
    });
  });

  it('returns lane ids for split and focused modes', () => {
    expect(visibleLaneIds(scene, 'both')).toEqual(['left', 'right']);
    expect(visibleLaneIds(scene, 'left')).toEqual(['left']);
    expect(visibleLaneIds(scene, 'right')).toEqual(['right']);
  });
});
