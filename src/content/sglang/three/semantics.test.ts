import { describe, it, expect } from 'vitest';
import { derivePdVisualState as pd } from './pd-state';
import { requestResources } from './request-state';

describe('mechanism resource ownership', () => {
  it('releases the finished request but keeps cache-owned KV and physical capacity', () => {
    expect(requestResources('execute')).toMatchObject({ requestSlots: 1, requestKv: true });
    expect(requestResources('complete')).toEqual({ requestSlots: 0, requestKv: false, cachedKv: true, physicalPool: true });
    expect(requestResources('arrive')).toMatchObject({ requestSlots: 0, requestKv: false, cachedKv: false });
  });
  it('rejects a busy switch before freeing or rebuilding any structures', () => {
    const initial = pd('busy', 'busy', 'v0521');
    const denied = pd('busy', 'rejected', 'v0521');
    expect(denied.gate).toBe('reject');
    for (const key of ['oldStructure', 'oldQueueOccupied', 'requestCount', 'poolOccupied', 'prefix', 'newStructure'] as const) {
      expect(denied[key]).toEqual(initial[key]);
    }
  });
  it('preserves the pool across teardown and rebuild while clearing prefixes', () => {
    const teardown = pd('normal', 'teardown', 'v0521');
    expect(teardown).toMatchObject({ oldStructure: 'removed', prefix: 'reset', newStructure: 'none', poolVisible: true });
    expect(pd('normal', 'supervise', 'v0521')).toMatchObject({ newStructure: 'ready', supervisor: 'active', health: 'ok', poolVisible: true });
  });
  it('does not invent a rollback or healthy instance after rebuild failure', () => {
    expect(pd('failed', 'rebuild-failed', 'v0521')).toMatchObject({ oldStructure: 'removed', newStructure: 'broken', prefix: 'reset', health: 'unhealthy', autoRollback: false, poolVisible: true });
    // Reverse seeking is deterministic, not a continuation from an unhealthy state.
    expect(pd('failed', 'drained', 'v0521')).toMatchObject({ oldStructure: 'present', prefix: 'present', health: 'ok' });
  });
  it('keeps the old version as an unavailable management path with existing PD resources', () => {
    expect(pd('normal', 'supervise', 'v0520')).toMatchObject({ api: 'blocked', oldStructure: 'present', poolVisible: true, newStructure: 'none', supervisor: 'fixed' });
  });
});
