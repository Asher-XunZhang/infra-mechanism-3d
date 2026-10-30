export type RequestId = 'R1' | 'R2';
export type MechanismModule = 'api' | 'tokenizer' | 'scheduler' | 'cache' | 'execution' | 'model' | 'detokenizer';
export interface MechanismRequest {
  id: RequestId;
  inputTokens: number[];
  outputTokens: number[];
  status: 'pending' | 'tokenized' | 'waiting' | 'prefill' | 'decode' | 'finished';
  matchedPrefix: number;
  /** Matched indices exist before a request-pool mapping is allocated. */
  prefixSlots: number[];
  requestSlot: number | null;
  kvSlots: number[];
}
export interface KVSlot {
  id: number;
  token: number;
  written: boolean;
  cached: boolean;
  requestRefs: RequestId[];
}
export interface CacheEntry { tokens: number[]; slots: number[]; }
export interface MechanismState {
  requests: MechanismRequest[];
  waiting: RequestId[];
  running: RequestId[];
  batch: { mode: 'idle' | 'prefill' | 'decode'; requestIds: RequestId[] };
  slots: KVSlot[];
  cache: CacheEntry[];
  capacity: number;
  generatedTokens: number;
  /** Number of input positions with reused KV, not an elapsed-time estimate. */
  reusedTokens: number;
}
export interface MechanismEvent {
  id: string;
  title: string;
  detail: string;
  duration: number;
  moduleIds: MechanismModule[];
  sourceIds: string[];
  payload: string;
  from: MechanismModule;
  to: MechanismModule;
  kind: 'transport' | 'queue' | 'match' | 'allocate' | 'prefill' | 'decode' | 'result' | 'release';
  requestId: RequestId;
  before: MechanismState;
  after: MechanismState;
}
export interface MechanismTrace {
  id: string;
  title: string;
  summary: string;
  assumptions: string[];
  sourceCommit: string;
  initial: MechanismState;
  final: MechanismState;
  events: MechanismEvent[];
}
