/** Teaching occupancy, not measured memory sizes. Radix caching is enabled. */
export function requestResources(stepId: string) {
  const active = ['schedule', 'execute', 'result', 'detokenize'].includes(stepId);
  return {
    requestSlots: active ? 1 : 0,
    requestKv: active,
    cachedKv: stepId === 'complete',
    physicalPool: true,
  };
}
