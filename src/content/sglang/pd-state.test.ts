import { describe, expect, it } from 'vitest';
import { sglangPack } from './index';
import { derivePdVisualState } from './three/pd-state';

describe('PD role-switch visual semantics', () => {
  it('keeps the physical pool visible while old queues and prefixes are removed', () => {
    const before = derivePdVisualState('normal', 'teardown', 'v0521');
    expect(before.oldStructure).toBe('removed');
    expect(before.prefix).toBe('reset');
    expect(before.poolVisible).toBe(true);
    expect(before.newStructure).toBe('none');

    const rebuilt = derivePdVisualState('normal', 'rebuild', 'v0521');
    expect(rebuilt.newStructure).toBe('ready');
    expect(rebuilt.poolVisible).toBe(true);
    expect(rebuilt.supervisor).toBe('hidden');
  });

  it('keeps busy requests, old queues and pool allocation when rejected', () => {
    const rejected = derivePdVisualState('busy', 'rejected', 'v0521');
    expect(rejected.gate).toBe('reject');
    expect(rejected.oldStructure).toBe('present');
    expect(rejected.requestCount).toBeGreaterThan(0);
    expect(rejected.poolOccupied).toBeGreaterThan(0);
    expect(rejected.newStructure).toBe('none');
    expect(rejected.health).toBe('busy');
    expect(rejected.autoRollback).toBe(false);
  });

  it('marks rebuild failure unhealthy without automatic rollback', () => {
    const failed = derivePdVisualState('failed', 'rebuild-failed', 'v0521');
    expect(failed.oldStructure).toBe('removed');
    expect(failed.prefix).toBe('reset');
    expect(failed.newStructure).toBe('broken');
    expect(failed.health).toBe('unhealthy');
    expect(failed.autoRollback).toBe(false);
    expect(failed.poolVisible).toBe(true);
  });

  it('keeps the legacy lane at the missing-management-path boundary', () => {
    const legacy = derivePdVisualState('normal', 'supervise', 'v0520');
    expect(legacy.api).toBe('blocked');
    expect(legacy.oldStructure).toBe('present');
    expect(legacy.newStructure).toBe('none');
    expect(legacy.supervisor).toBe('fixed');
    expect(legacy.status).toContain('此管理 API');
  });
});

describe('SGLang pack wiring', () => {
  it('keeps three scenes with their own fixed provenance', () => {
    expect(sglangPack.scenes.map((scene) => scene.id)).toEqual([
      'overview',
      'request-flow',
      'pd-compare',
    ]);
    const pd = sglangPack.scenes[2];
    expect(pd.provenance.commit).toContain('94602c9');
    expect(pd.provenance.commit).toContain('e00930c');
    expect(pd.lanes.map((lane) => lane.commit)).toEqual([
      '94602c9c2b7cbdb8efd5c52802dac6a1c180089e',
      'e00930c5489053f26d86b179cee0d087f846acbb',
    ]);
    expect(pd.scenarios.map((scenario) => scenario.id)).toEqual([
      'normal',
      'busy',
      'failed',
    ]);
    expect(pd.buildLane).toBeTypeOf('function');
  });
});
