import { sampleTimeline } from '../../core/timeline';
import type { MechanismEvent, MechanismState, MechanismTrace, RequestId } from './mechanism-types';
export type * from './mechanism-types';

const COMMIT = '279339f113b79af84f27fd3ac92d0a13bd3f4cbd';
const copy = <T>(value: T): T => structuredClone(value);
const request = (state: MechanismState, id: RequestId) => state.requests.find(r => r.id === id)!;

/** Deterministic teaching trace. Token IDs and pool positions are illustrative. */
export function createMechanismTrace(options: { sharedPrefix?: boolean } = {}): MechanismTrace {
  const shared = options.sharedPrefix !== false;
  const initial: MechanismState = {
    requests: [
      { id: 'R1', inputTokens: [11, 12, 13, 14], outputTokens: [], status: 'pending', matchedPrefix: 0, prefixSlots: [], requestSlot: null, kvSlots: [] },
      { id: 'R2', inputTokens: shared ? [11, 12, 21, 22] : [31, 32, 21, 22], outputTokens: [], status: 'pending', matchedPrefix: 0, prefixSlots: [], requestSlot: null, kvSlots: [] },
    ],
    waiting: [], running: [], batch: { mode: 'idle', requestIds: [] }, slots: [], cache: [], capacity: 12, generatedTokens: 0, reusedTokens: 0,
  };
  let state = copy(initial);
  const events: MechanismEvent[] = [];
  function emit(meta: Omit<MechanismEvent, 'before' | 'after'>, mutate: (s: MechanismState) => void = () => {}) {
    const before = copy(state);
    mutate(state);
    const after = copy(state);
    events.push({ ...meta, before, after });
  }
  function cacheWritten(s: MechanismState, id: RequestId) {
    const r = request(s, id);
    const indices = r.kvSlots.filter(index => s.slots[index].written);
    const entry = { tokens: indices.map(index => s.slots[index].token), slots: [...indices] };
    // One path per request; shared physical indices are never copied.
    const old = s.cache.findIndex(c => c.tokens.every((token, i) => token === entry.tokens[i]) && c.tokens.length <= entry.tokens.length);
    if (old >= 0) s.cache[old] = entry;
    else s.cache.push(entry);
    indices.forEach(index => { s.slots[index].cached = true; });
  }
  function allocate(s: MechanismState, id: RequestId, tokens: number[]) {
    const r = request(s, id);
    for (const token of tokens) {
      if (s.slots.length >= s.capacity) throw new Error('Teaching trace exceeded physical pool');
      const slot = s.slots.length;
      s.slots.push({ id: slot, token, written: false, cached: false, requestRefs: [id] });
      r.kvSlots.push(slot);
    }
  }
  for (const id of ['R1', 'R2'] as const) {
    const tokenBase = id === 'R1' ? 100 : 200;
    emit({ id: `${id}.arrive`, title: `${id}：文字进入服务`, detail: '同一个请求身份贯穿进程交接；示例采用非流式最终回告，数字是教学 token ID。', duration: 1.6, kind: 'transport', requestId: id, from: 'api', to: 'tokenizer', moduleIds: ['api', 'tokenizer'], sourceIds: ['overview.api.0', 'overview.tokenizer.0'], payload: `${id} · 输入文本` }, s => { request(s, id).status = 'tokenized'; });
    emit({ id: `${id}.queue`, title: `${id}：token IDs 派发并入队`, detail: 'TokenizerManager 派发带请求身份的输入；Scheduler 持有等待请求。这里没有把 KV 张量通过入口网络发送。', duration: 1.6, kind: 'queue', requestId: id, from: 'tokenizer', to: 'scheduler', moduleIds: ['tokenizer', 'scheduler'], sourceIds: ['overview.tokenizer.0', 'overview.scheduler.0'], payload: `${id} · [${request(state, id).inputTokens.join(', ')}]` }, s => { request(s, id).status = 'waiting'; s.waiting.push(id); });
    emit({ id: `${id}.match`, title: `${id}：沿 token 前缀查找`, detail: '在同一缓存命名空间内查找最长可用前缀，返回已有槽位索引。树节点保存索引；K/V 数值仍留在设备池。', duration: 2.4, kind: 'match', requestId: id, from: 'scheduler', to: 'cache', moduleIds: ['scheduler', 'cache'], sourceIds: ['overview.cache.1'], payload: `${id} · prefix → device indices` }, s => {
      const r = request(s, id);
      let matched: number[] = [];
      for (const entry of s.cache) {
        let length = 0;
        while (length < r.inputTokens.length && length < entry.tokens.length && entry.tokens[length] === r.inputTokens[length]) length++;
        if (length > matched.length) matched = entry.slots.slice(0, length);
      }
      r.matchedPrefix = matched.length;
      r.prefixSlots = matched;
      s.reusedTokens += matched.length;
      matched.forEach(index => s.slots[index].requestRefs.push(id));
    });
    emit({ id: `${id}.allocate`, title: `${id}：选入 Prefill，分配未命中位置`, detail: '请求槽位映射先接上命中的物理位置，只为未命中输入分配新槽位；新分配不代表 K/V 已经写入。', duration: 2.2, kind: 'allocate', requestId: id, from: 'cache', to: 'scheduler', moduleIds: ['scheduler', 'cache'], sourceIds: ['overview.scheduler.1', 'overview.cache.0'], payload: `${id} · Req → KV slots` }, s => {
      const r = request(s, id);
      r.requestSlot = 0; r.status = 'prefill'; r.kvSlots = [...r.prefixSlots];
      allocate(s, id, r.inputTokens.slice(r.matchedPrefix));
      s.waiting = s.waiting.filter(item => item !== id); s.running = [id]; s.batch = { mode: 'prefill', requestIds: [id] };
    });
    emit({ id: `${id}.prefill`, title: `${id}：执行未命中输入的 Prefill`, detail: 'Worker/Runner 准备 forward；Attention 读取复用前缀，只写入新增输入位置的 K/V。采样结果随后交回调度器。', duration: 2.6, kind: 'prefill', requestId: id, from: 'execution', to: 'model', moduleIds: ['scheduler', 'execution', 'model', 'cache'], sourceIds: ['overview.execution.0', 'overview.execution.2', 'overview.model.1', 'overview.cache.2'], payload: `${id} · 未命中输入 → forward` }, s => { request(s, id).kvSlots.forEach(index => { s.slots[index].written = true; }); });
    emit({ id: `${id}.prefill-result`, title: `${id}：第一个输出 token 回到调度器`, detail: 'Prefill 采样产生第一个输出 token；它已进入 output_ids，但还没有自身 K/V。未完成请求可将已计算前缀加入缓存并持有锁引用。', duration: 1.7, kind: 'result', requestId: id, from: 'execution', to: 'scheduler', moduleIds: ['execution', 'scheduler', 'cache'], sourceIds: ['overview.execution.3', 'overview.scheduler.2', 'overview.cache.1'], payload: `${id} · output token ${tokenBase + 1}` }, s => {
      request(s, id).outputTokens.push(tokenBase + 1); request(s, id).status = 'decode'; s.generatedTokens++; cacheWritten(s, id);
    });
    for (let iteration = 1; iteration <= 2; iteration++) {
      emit({ id: `${id}.decode-${iteration}-prepare`, title: `${id}：准备第 ${iteration} 轮 Decode`, detail: 'Scheduler 再次选择未完成请求。上一轮新采样的 token 成为这一轮输入；为它增加一个可写位置。', duration: 1.5, kind: 'allocate', requestId: id, from: 'scheduler', to: 'execution', moduleIds: ['scheduler', 'execution', 'cache'], sourceIds: ['overview.scheduler.0', 'overview.scheduler.1'], payload: `${id} · 上一输出 ${tokenBase + iteration} → 本轮输入` }, s => {
        allocate(s, id, [tokenBase + iteration]); s.batch = { mode: 'decode', requestIds: [id] };
      });
      emit({ id: `${id}.decode-${iteration}`, title: `${id}：第 ${iteration} 轮 Decode forward`, detail: '读取历史 K/V，为本轮输入写入新 K/V，再采样下一个 token。一次 forward 不是生成整段回答。', duration: 2.1, kind: 'decode', requestId: id, from: 'execution', to: 'model', moduleIds: ['execution', 'model', 'cache'], sourceIds: ['overview.execution.2', 'overview.model.1', 'overview.cache.2'], payload: `${id} · 读历史 KV + 写 token ${tokenBase + iteration} 的 KV` }, s => { const r = request(s, id); s.slots[r.kvSlots.at(-1)!].written = true; });
      emit({ id: `${id}.decode-${iteration}-result`, title: `${id}：收到第 ${iteration + 1} 个输出 token`, detail: iteration === 2 ? '达到本例 max_new_tokens=3。最后采样的 token 尚未再次进入 forward，因此本例没有它的 K/V。接下来处理完成与资源引用。' : '更新 output_ids 后仍未完成；同一请求继续参与下一次调度，不创建另一份请求。', duration: 1.6, kind: 'result', requestId: id, from: 'execution', to: 'scheduler', moduleIds: ['execution', 'scheduler'], sourceIds: ['overview.execution.3', 'overview.scheduler.2'], payload: `${id} · output token ${tokenBase + iteration + 1}` }, s => {
        request(s, id).outputTokens.push(tokenBase + iteration + 1); s.generatedTokens++;
        if (iteration === 2) request(s, id).status = 'finished';
      });
    }
    emit({ id: `${id}.release`, title: `${id}：释放请求引用，缓存保留已计算 KV`, detail: '缓存接管可缓存索引，释放请求槽位与锁引用。这里没有内存压力和淘汰；请求结束不代表物理 KV 池清空。', duration: 2.3, kind: 'release', requestId: id, from: 'scheduler', to: 'cache', moduleIds: ['scheduler', 'cache'], sourceIds: ['overview.cache.1', 'overview.scheduler.2'], payload: `${id} · 请求引用释放 / cache 持有` }, s => {
      const r = request(s, id); cacheWritten(s, id);
      s.slots.forEach(slot => { slot.requestRefs = slot.requestRefs.filter(ref => ref !== id); });
      r.requestSlot = null; r.kvSlots = []; s.running = []; s.batch = { mode: 'idle', requestIds: [] };
    });
    emit({ id: `${id}.output`, title: `${id}：输出 token 反分词并回告`, detail: '输出载荷是 token IDs 与请求标识，反分词后交回客户端；已缓存的设备 K/V 不随回答传输。', duration: 1.7, kind: 'transport', requestId: id, from: 'scheduler', to: 'detokenizer', moduleIds: ['scheduler', 'detokenizer', 'tokenizer'], sourceIds: ['overview.detokenizer.0', 'overview.tokenizer.1'], payload: `${id} · [${tokenBase + 1}, ${tokenBase + 2}, ${tokenBase + 3}] → 文本` });
  }
  return {
    id: shared ? 'shared-prefix' : 'distinct-prefix',
    title: '从两条请求看调度、前缀复用与 Decode',
    summary: shared ? 'R2 复用 R1 的两个输入位置；同一份物理 KV 可以被缓存持有并被请求引用。' : 'R2 的输入前缀不同，需要为全部输入分配位置；生成步骤与输出长度保持相同。',
    assumptions: ['固定 main 提交的普通生成路径；关闭 overlap、chunk、speculation、淘汰和分离部署。', '教学设定：全注意力、page_size=1、同模型与缓存命名空间，12 个示意槽位，每请求生成 3 个 token。', 'R2 在 R1 完成后进入。缓存路径按 token 展开，省略真实 radix 压缩节点、锁层级与 GPU 张量维度。', '输出 token IDs 是占位例子；播放时长不是推理耗时，节省的位置数不等于实测加速比。'],
    sourceCommit: COMMIT, initial, final: copy(state), events,
  };
}

export function sampleMechanism(trace: MechanismTrace, time: number) {
  const sample = sampleTimeline(trace.events.map(event => event.duration), time);
  const event = trace.events[sample.index];
  return { ...sample, event, before: event.before, after: event.after, state: sample.progress < 1 ? event.before : event.after };
}
