import { visibleLaneIds } from '../state';
import type { SceneReadout } from '../types';
import type { ViewerUiSnapshot } from './types';

/**
 * Ask the content pack for a readout of the current reading position. Content
 * errors degrade to "no readout"; they must not take down the viewer shell.
 */
export function readSceneReadout(
  snapshot: ViewerUiSnapshot,
): SceneReadout | null {
  const { scene, scenario, step, state, playback } = snapshot;
  if (!scene.readout) {
    return null;
  }
  const laneIds = visibleLaneIds(scene, state.laneMode);
  const lane = scene.lanes.find((candidate) => candidate.id === laneIds[0]);
  if (!lane) {
    return null;
  }
  try {
    return scene.readout({
      scenario,
      step,
      stepIndex: state.stepIndex,
      stepCount: snapshot.stepCount,
      progress: playback.progress,
      time: playback.time,
      lane,
      moduleId: state.moduleId,
      options: state.options,
      reducedMotion: snapshot.reducedMotion,
    });
  } catch {
    return null;
  }
}
