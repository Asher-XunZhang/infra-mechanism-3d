import { describe, expect, it } from 'vitest';
import { moduleDocs } from './modules';
import { compareScenarios, pdLanes, requestFlowSceneData } from './scenarios';
import {
  MAIN_COMMIT,
  PD_NEW_COMMIT,
  PD_OLD_COMMIT,
  allSources,
  overviewEvidence,
} from './sources';

describe('SGLang source evidence contract', () => {
  it('keeps all 19 overview anchors and their fixed main commit', () => {
    expect(overviewEvidence.revision).toBe(MAIN_COMMIT);
    expect(MAIN_COMMIT).toBe('279339f113b79af84f27fd3ac92d0a13bd3f4cbd');
    expect(overviewEvidence.nodes).toHaveLength(7);
    expect(
      overviewEvidence.nodes.reduce((total, node) => total + node.sources.length, 0),
    ).toBe(19);
  });

  it('keeps distinct, fixed commits for each PD side', () => {
    expect(PD_OLD_COMMIT).toBe('94602c9c2b7cbdb8efd5c52802dac6a1c180089e');
    expect(PD_NEW_COMMIT).toBe('e00930c5489053f26d86b179cee0d087f846acbb');
    expect(PD_OLD_COMMIT).not.toBe(PD_NEW_COMMIT);
    expect(pdLanes.map((lane) => lane.commit)).toEqual([PD_OLD_COMMIT, PD_NEW_COMMIT]);
  });

  it('resolves every source reference used by module and step docs', () => {
    for (const module of Object.values(moduleDocs)) {
      for (const sourceId of module.sourceIds) {
        expect(allSources[sourceId], `${module.id} -> ${sourceId}`).toBeDefined();
      }
    }
    for (const scenario of compareScenarios) {
      for (const step of scenario.steps) {
        expect(step.moduleIds.length, `${scenario.id}/${step.id} modules`).toBeGreaterThan(0);
        for (const moduleId of step.moduleIds) {
          expect(moduleDocs[moduleId], `${scenario.id}/${step.id} -> ${moduleId}`).toBeDefined();
        }
        for (const sourceId of step.sourceIds ?? []) {
          expect(allSources[sourceId], `${scenario.id}/${step.id} -> ${sourceId}`).toBeDefined();
        }
      }
    }
    for (const step of requestFlowSceneData.scenarios[0].steps) {
      for (const moduleId of step.moduleIds) {
        expect(moduleDocs[moduleId], `flow/${step.id} -> ${moduleId}`).toBeDefined();
      }
      for (const sourceId of step.sourceIds ?? []) {
        expect(allSources[sourceId], `flow/${step.id} -> ${sourceId}`).toBeDefined();
      }
    }
  });

  it('keeps the old-side boundary exact and does not erase PD/PDMux', () => {
    expect(pdLanes[0].status).toBe('此管理 API 与 supervisor 路径不可用');
    expect(pdLanes[0].note).toContain('旧版仍有 PD 与 PDMux');
    expect(moduleDocs['pd.legacy_loop'].boundaries.join(' ')).toContain('旧版仍有 PD 与 PDMux');
  });

  it('covers normal, busy rejection and unhealthy rebuild branches', () => {
    expect(compareScenarios.map((scenario) => scenario.id)).toEqual([
      'normal',
      'busy',
      'failed',
    ]);
    const busy = compareScenarios.find((scenario) => scenario.id === 'busy');
    const failed = compareScenarios.find((scenario) => scenario.id === 'failed');
    expect(busy?.steps.some((step) => step.id === 'rejected')).toBe(true);
    expect(busy?.steps.at(-1)?.laneFacts?.v0521?.status).toContain('不空闲');
    expect(failed?.steps.at(-1)?.laneFacts?.v0521?.status).toContain('unhealthy');
    expect(failed?.steps.at(-1)?.laneFacts?.v0521?.detail).toContain('无就地回滚');
  });

  it('marks the decode graph path as an explicit teaching assumption', () => {
    const normal = compareScenarios[0];
    const graph = normal.conditions?.find((condition) => condition.id === 'graph-headroom');
    expect(graph?.status).toBe('assumed');
    expect(graph?.detail).toContain('假定通过');
  });
});
