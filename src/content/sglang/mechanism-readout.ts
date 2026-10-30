import type {
  MechanismEvent,
  MechanismState,
  MechanismTrace,
  MechanismRequest,
} from './mechanism-types';
import { sampleMechanism } from './mechanism';
import type {
  ReadoutGroup,
  ReadoutRow,
  ReadoutTone,
  SceneReadout,
  ViewerStep,
} from '../../viewer/types';

const STEP_LABELS: Record<MechanismEvent['kind'], string> = {
  transport: '到达与回告',
  queue: '入队',
  match: '前缀匹配',
  allocate: '分配位置',
  prefill: '预填充',
  decode: '逐 token 解码',
  result: '结果处理',
  release: '释放引用',
};

const BATCH_LABELS: Record<MechanismState['batch']['mode'], string> = {
  idle: '空闲',
  prefill: '预填充',
  decode: '逐 token 解码',
};

const EXTRA_SOURCE_IDS = {
  match: ['mechanism.match_prefix'],
  extend: ['mechanism.extend_allocate'],
  decodePrepare: ['mechanism.decode_prepare', 'mechanism.decode_allocate'],
  prefillResult: ['mechanism.prefill_result', 'mechanism.cache_unfinished'],
  decodeResult: ['mechanism.decode_result'],
  release: ['mechanism.cache_finished', 'mechanism.cache_unfinished'],
} as const;

/** Attach the fixed anchors that explain the modeled transition itself. */
function sourceIdsFor(event: MechanismEvent): string[] {
  const extra =
    event.kind === 'match'
      ? EXTRA_SOURCE_IDS.match
      : event.kind === 'allocate'
        ? /(?:^|\.)decode-\d+-prepare$/.test(event.id)
          ? EXTRA_SOURCE_IDS.decodePrepare
          : EXTRA_SOURCE_IDS.extend
        : event.id.endsWith('.prefill-result')
          ? EXTRA_SOURCE_IDS.prefillResult
          : event.kind === 'result'
            ? EXTRA_SOURCE_IDS.decodeResult
            : event.kind === 'release'
              ? EXTRA_SOURCE_IDS.release
              : [];
  return [...new Set([...event.sourceIds, ...extra])];
}

const MODULE_LABELS: Record<string, string> = {
  api: '入口',
  tokenizer: '分词器',
  scheduler: '调度器',
  cache: '缓存 / KV 池',
  execution: '执行器',
  model: '模型前向',
  detokenizer: '反分词器',
};

const STATUS_LABELS: Record<MechanismRequest['status'], string> = {
  pending: '待处理',
  tokenized: '已分词',
  waiting: '等待',
  prefill: '预填充',
  decode: '逐 token 解码',
  finished: '已完成',
};

const STATUS_TONES: Record<MechanismRequest['status'], ReadoutTone> = {
  pending: 'neutral',
  tokenized: 'held',
  waiting: 'held',
  prefill: 'active',
  decode: 'active',
  finished: 'done',
};

const KIND_TONES: Record<MechanismEvent['kind'], ReadoutTone> = {
  transport: 'active',
  queue: 'held',
  match: 'active',
  allocate: 'active',
  prefill: 'active',
  decode: 'active',
  result: 'done',
  release: 'warning',
};

/** Steps mirror the trace's deterministic events. Durations are reading time. */
export function buildMechanismSteps(trace: MechanismTrace): ViewerStep[] {
  return trace.events.map((event) => ({
    id: event.id,
    label: `${event.requestId} · ${STEP_LABELS[event.kind]}`,
    title: event.title,
    summary: event.detail,
    points: [
      `涉及模块：${event.moduleIds.map((id) => MODULE_LABELS[id] ?? id).join(' · ')}`,
    ],
    moduleIds: [...event.moduleIds],
    sourceIds: sourceIdsFor(event),
    duration: event.duration,
  }));
}

function requestRows(
  state: MechanismState,
  requestId: MechanismEvent['requestId'],
): ReadoutRow[] {
  return state.requests.map((request) => {
    const active = request.id === requestId;
    const slots = request.kvSlots.length
      ? request.kvSlots.map((index) => `#${index}`).join(' ')
      : '尚无映射';
    return {
      id: `request-${request.id}`,
      label: `${request.id} · ${STATUS_LABELS[request.status]}`,
      meta: `${request.inputTokens.join(',')} → ${
        request.outputTokens.length ? request.outputTokens.join(',') : '…'
      }`,
      detail: `复用 ${request.matchedPrefix} 个输入位置 · 请求映射 ${
        request.requestSlot ?? '—'
      } · KV ${slots}`,
      tone: active ? 'active' : STATUS_TONES[request.status],
    };
  });
}

function slotRows(
  state: MechanismState,
  activeRequestId: MechanismEvent['requestId'],
): ReadoutRow[] {
  const rows: ReadoutRow[] = [];
  for (let index = 0; index < state.capacity; index++) {
    const slot = state.slots[index];
    if (!slot) {
      rows.push({
        id: `slot-${index}`,
        label: `槽 ${String(index).padStart(2, '0')} · 空闲`,
        meta: '可分配',
        tone: 'neutral',
      });
      continue;
    }
    const flags = [
      slot.written ? '已写入' : '未写入',
      slot.cached ? '缓存持有' : '未缓存',
      slot.requestRefs.length ? `引用 ${slot.requestRefs.join(' · ')}` : '无请求引用',
    ];
    const tone: ReadoutTone = slot.requestRefs.includes(activeRequestId)
      ? 'active'
      : slot.cached
        ? 'done'
        : slot.written
          ? 'held'
          : 'neutral';
    rows.push({
      id: `slot-${index}`,
      label: `槽 ${String(index).padStart(2, '0')} · token ${slot.token}`,
      meta: flags.join(' / '),
      tone,
    });
  }
  return rows;
}

function cacheRows(state: MechanismState): ReadoutRow[] {
  if (!state.cache.length) {
    return [
      {
        id: 'cache-empty',
        label: '缓存尚无已计算的 token 路径',
        meta: '缓存持有在预填充结果处理后才出现',
        tone: 'neutral',
      },
    ];
  }
  return state.cache.map((entry, index) => ({
    id: `cache-${index}`,
    label: `路径 ${index + 1} · [${entry.tokens.join(', ')}]`,
    meta: `物理槽 ${entry.slots.map((slot) => `#${slot}`).join(' ')} · 只存索引，不复制 K/V`,
    tone: 'done',
  }));
}

function groupsFor(
  state: MechanismState,
  event: MechanismEvent,
  moduleId: string | null,
): ReadoutGroup[] {
  const requests = requestRows(state, event.requestId);
  const queue: ReadoutGroup = {
    id: 'queue',
    title: '请求队列与批次',
    note: '请求引用与缓存持有可以同时存在；槽位写入后才算已有 K/V。',
    rows: [
      {
        id: 'waiting',
        label: `等待队列 · ${state.waiting.length ? state.waiting.join(', ') : '空'}`,
        tone: state.waiting.length ? 'held' : 'neutral',
      },
      {
        id: 'running',
        label: `运行中 · ${state.running.length ? state.running.join(', ') : '空'}`,
        tone: state.running.length ? 'active' : 'neutral',
      },
      {
        id: 'batch',
        label: `当前批次 · ${BATCH_LABELS[state.batch.mode]}${
          state.batch.requestIds.length
            ? ` [${state.batch.requestIds.join(', ')}]`
            : ''
        }`,
        tone: state.batch.mode === 'idle' ? 'neutral' : 'active',
      },
    ],
  };
  const kv: ReadoutGroup = {
    id: 'kv',
    title: '物理 KV 池 / 槽位',
    note: `教学池容量 ${state.capacity}，page_size=1；槽号与 token 都是示意。`,
    rows: slotRows(state, event.requestId),
  };
  const cache: ReadoutGroup = {
    id: 'cache',
    title: '缓存路径与所有权',
    note: '前缀命中复用同一物理槽；释放请求引用不等于清空物理池。',
    rows: cacheRows(state),
  };
  const requestGroup: ReadoutGroup = {
    id: 'requests',
    title: '请求身份与生成进度',
    note: 'R1 / R2 是稳定请求身份；最后采样的 token 还没有自身 K/V。',
    rows: requests,
  };

  if (!moduleId) return [requestGroup, queue, kv, cache];
  if (moduleId === 'cache') return [cache, kv, requestGroup, queue];
  if (moduleId === 'scheduler') return [queue, requestGroup, kv, cache];
  if (moduleId === 'execution' || moduleId === 'model') {
    return [requestGroup, queue, kv, cache];
  }
  if (moduleId === 'api' || moduleId === 'tokenizer' || moduleId === 'detokenizer') {
    return [requestGroup, queue, kv, cache];
  }
  return [requestGroup, queue, kv, cache];
}

export function buildMechanismReadout(
  trace: MechanismTrace,
  time: number,
  moduleId: string | null,
): SceneReadout {
  const sample = sampleMechanism(trace, time);
  const event = sample.event;
  const state = sample.state;
  const pending = sample.progress < 1;
  return {
    eyebrow: `${event.requestId} · ${STEP_LABELS[event.kind]} · ${
      pending ? '进行中' : '已发布'
    }`,
    title: event.title,
    detail: `${event.detail} 事件载荷：${event.payload}。${
      pending
        ? '对象与结果仍停在动作前；当前动画完成后才提交新状态。'
        : '依赖动作已完成，以下为完成后的读数。'
    }`,
    pending,
    stats: [
      {
        label: '阅读事件',
        value: `${sample.index + 1} / ${trace.events.length}`,
        tone: pending ? 'active' : 'done',
      },
      {
        label: '池槽',
        value: `${state.slots.length} / ${state.capacity}`,
        tone: state.slots.length ? 'held' : 'neutral',
      },
      {
        label: '复用位置',
        value: String(state.reusedTokens),
        tone: state.reusedTokens ? 'done' : 'neutral',
      },
      {
        label: '已生成',
        value: `${state.generatedTokens} / 6`,
        tone: state.generatedTokens ? 'done' : 'neutral',
      },
      {
        label: '批次',
        value: BATCH_LABELS[state.batch.mode],
        tone: state.batch.mode === 'idle' ? 'neutral' : 'active',
      },
      {
        label: '动作进度',
        value: `${Math.round(sample.progress * 100)}%`,
        tone: pending ? 'active' : 'done',
      },
    ],
    groups: groupsFor(state, event, moduleId),
  };
}

export function mechanismStepLabel(event: MechanismEvent): string {
  return `${event.requestId} · ${STEP_LABELS[event.kind]}`;
}

export { KIND_TONES };
