import { describe, expect, it } from 'vitest';
import { createMechanismTrace, sampleMechanism } from './mechanism';

describe('source-bounded SGLang mechanism model', () => {
  it('reuses physical slots instead of allocating a second prefix copy', () => {
    const shared = createMechanismTrace(), distinct = createMechanismTrace({ sharedPrefix: false });
    const allocated = shared.events.find(event => event.id === 'R2.allocate')!.after;
    const matched = shared.events.find(event => event.id === 'R2.match')!.after.requests[1];
    expect(matched).toMatchObject({ prefixSlots: [0, 1], kvSlots: [], requestSlot: null });
    expect(allocated.requests[1].kvSlots.slice(0, 2)).toEqual([0, 1]);
    expect(allocated.slots[0]).toMatchObject({ cached: true, requestRefs: ['R2'] });
    expect(shared.final.slots.length).toBe(10);
    expect(distinct.final.slots.length).toBe(12);
    expect(shared.final.reusedTokens).toBe(2);
    expect(distinct.final.reusedTokens).toBe(0);
  });
  it('separates allocation, KV writes, sampled output and request release', () => {
    const trace = createMechanismTrace();
    const byId = (id: string) => trace.events.find(event => event.id === id)!.after;
    expect(byId('R1.allocate').slots.every(slot => !slot.written)).toBe(true);
    expect(byId('R1.prefill').requests[0].outputTokens).toEqual([]);
    expect(byId('R1.prefill-result').requests[0].outputTokens).toEqual([101]);
    expect(byId('R1.prefill-result').cache[0].tokens).toEqual([11, 12, 13, 14]);
    expect(byId('R1.decode-1-prepare').slots.at(-1)).toMatchObject({ token: 101, written: false });
    expect(byId('R1.decode-1').slots.at(-1)?.written).toBe(true);
    expect(byId('R1.release').slots.map(slot => slot.token)).toEqual([11, 12, 13, 14, 101, 102]);
    expect(byId('R1.release').slots.every(slot => slot.cached && !slot.requestRefs.length)).toBe(true);
    expect(byId('R1.release').requests[0]).toMatchObject({ requestSlot: null, kvSlots: [] });
  });
  it('keeps references valid at every event boundary and supports deterministic reverse seek', () => {
    const trace = createMechanismTrace();
    let time = 0;
    for (const event of trace.events) {
      const middle = time + event.duration / 2;
      expect(sampleMechanism(trace, middle).state).toEqual(event.before);
      expect(sampleMechanism(trace, middle)).toEqual(sampleMechanism(trace, middle));
      for (const state of [event.before, event.after]) {
        expect(new Set(state.slots.map(slot => slot.id)).size).toBe(state.slots.length);
        expect(state.slots.length).toBeLessThanOrEqual(state.capacity);
        for (const req of state.requests) for (const slot of req.kvSlots) {
          expect(state.slots[slot].requestRefs).toContain(req.id);
        }
        for (const entry of state.cache) for (const slot of entry.slots) expect(state.slots[slot].cached).toBe(true);
      }
      time += event.duration;
    }
    expect(sampleMechanism(trace, time).state).toEqual(trace.final);
    expect(trace.final.generatedTokens).toBe(6);
    expect(trace.events.filter(event => event.kind === 'decode')).toHaveLength(4);
  });
});
