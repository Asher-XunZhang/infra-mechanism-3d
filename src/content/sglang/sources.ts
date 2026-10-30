import overviewEvidenceJson from '../../../docs/sglang-overview-evidence.json';
import type { SourceAnchor } from '../../viewer/types';

interface OverviewEvidenceNode {
  id: string;
  title: string;
  name: string;
  directory: string;
  why: string;
  action: string;
  sources: Array<[string, number, string]>;
  phase: string[];
}

interface OverviewEvidence {
  repository: string;
  revision: string;
  reviewed: string;
  scope: string;
  nodes: OverviewEvidenceNode[];
}

export const overviewEvidence = overviewEvidenceJson as OverviewEvidence;

export const SGLANG_REPOSITORY = overviewEvidence.repository;
export const MAIN_COMMIT = overviewEvidence.revision;
export const REVIEW_DATE = overviewEvidence.reviewed;

export const PD_OLD_COMMIT = '94602c9c2b7cbdb8efd5c52802dac6a1c180089e';
export const PD_NEW_COMMIT = 'e00930c5489053f26d86b179cee0d087f846acbb';

function short(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function overviewAnchor(
  node: OverviewEvidenceNode,
  source: [string, number, string],
  index: number,
): SourceAnchor {
  const [path, line, symbol] = source;
  return {
    id: `overview.${node.id}.${index}`,
    label: `${short(path)}:${line}`,
    repository: overviewEvidence.repository,
    commit: overviewEvidence.revision,
    path,
    startLine: line,
    symbol,
  };
}

const overviewSources: Record<string, SourceAnchor> = {};
for (const node of overviewEvidence.nodes) {
  node.sources.forEach((source, index) => {
    const anchor = overviewAnchor(node, source, index);
    overviewSources[anchor.id] = anchor;
  });
}

export const overviewSourceIdsByNode: Record<string, string[]> = Object.fromEntries(
  overviewEvidence.nodes.map((node) => [
    node.id,
    node.sources.map((_, index) => `overview.${node.id}.${index}`),
  ]),
);

export const versionSources: Record<string, SourceAnchor> = {
  'old.dispatch': {
    id: 'old.dispatch',
    label: 'scheduler.py:5692–5719',
    repository: SGLANG_REPOSITORY,
    commit: PD_OLD_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 5692,
    endLine: 5719,
    symbol: 'dispatch_event_loop',
    note: '旧侧按启动时的角色直接选择对应循环；没有运行中重分派 supervisor。',
  },
  'old.http_file': {
    id: 'old.http_file',
    label: 'http_server.py（固定文件，无 /pd_role_switch）',
    repository: SGLANG_REPOSITORY,
    commit: PD_OLD_COMMIT,
    path: 'python/sglang/srt/entrypoints/http_server.py',
    startLine: 1,
    symbol: '固定 commit 全文',
    note: '已对固定文件核对；这里链接文件而不是伪造 404 行号。旧版仍有 PD 与 PDMux。',
  },
  'new.http': {
    id: 'new.http',
    label: 'http_server.py:1577–1592',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/entrypoints/http_server.py',
    startLine: 1577,
    endLine: 1592,
    symbol: 'POST /pd_role_switch',
    note: '管理入口交给 TokenizerManager；成功返回 200，失败返回 400。',
  },
  'new.scheduler_dispatch': {
    id: 'new.scheduler_dispatch',
    label: 'scheduler.py:1793',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 1793,
    symbol: 'PdRoleSwitchReqInput, self.handle_pd_role_switch',
  },
  'new.scheduler_handle': {
    id: 'new.scheduler_handle',
    label: 'scheduler.py:5832–5833',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 5832,
    endLine: 5833,
    symbol: 'handle_pd_role_switch',
  },
  'new.restart': {
    id: 'new.restart',
    label: 'scheduler.py:2122–2127',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 2122,
    endLine: 2127,
    symbol: '_event_loop_should_restart',
    note: '成功响应发出后，旧角色循环以 PdRoleSwitchRestart 退出。',
  },
  'new.dispatch': {
    id: 'new.dispatch',
    label: 'scheduler.py:5932–5937',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 5932,
    endLine: 5937,
    symbol: 'dispatch_event_loop',
  },
  'new.role_file': {
    id: 'new.role_file',
    label: 'role_switch.py:1–5',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 1,
    endLine: 5,
    symbol: 'Runtime prefill<->decode role switching',
    note: '物理 token KV pool 与角色无关，不重新分配。',
  },
  'new.supervisor': {
    id: 'new.supervisor',
    label: 'role_switch.py:29–40',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 29,
    endLine: 40,
    symbol: 'run_event_loop_supervisor',
  },
  'new.same_role': {
    id: 'new.same_role',
    label: 'role_switch.py:66–72',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 66,
    endLine: 72,
    symbol: 'new_role == old_role',
    note: '目标角色与当前角色相同时返回 already in target role。',
  },
  'new.idle': {
    id: 'new.idle',
    label: 'role_switch.py:73–77',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 73,
    endLine: 77,
    symbol: 'is_fully_idle',
    note: '有在途请求时返回失败并设置 safe_to_restore；不触发 teardown。',
  },
  'new.graph': {
    id: 'new.graph',
    label: 'role_switch.py:79–111',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 79,
    endLine: 111,
    symbol: 'decode_cuda_graph_memory_gb',
    note: '切到 decode 且尚未捕获 graph 时，先声明所需内存并检查余量。',
  },
  'new.graph_deferred': {
    id: 'new.graph_deferred',
    label: 'role_switch.py:137–144',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 137,
    endLine: 144,
    symbol: 'ensure_decode_cuda_graphs',
    note: '延后的 Graph 捕获失败只降级为 eager，不标记拆除/重建失败。',
  },
  'new.teardown_rebuild': {
    id: 'new.teardown_rebuild',
    label: 'role_switch.py:113–135',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 113,
    endLine: 135,
    symbol: 'teardown + flip + rebuild',
    note: '拆旧、翻转、重建是一个逻辑原子步骤。',
  },
  'new.restart_flag': {
    id: 'new.restart_flag',
    label: 'role_switch.py:146–150',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 146,
    endLine: 150,
    symbol: '_event_loop_should_restart',
  },
  'new.reject': {
    id: 'new.reject',
    label: 'role_switch.py:159–215',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 159,
    endLine: 215,
    symbol: '_reject_reason',
    note: '按表检查开关、健康、重入、目标角色、PD 模式、后端能力和 staging。',
  },
  'new.teardown': {
    id: 'new.teardown',
    label: 'role_switch.py:229–253',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 229,
    endLine: 253,
    symbol: 'teardown_disaggregation',
    note: '拆除当前角色的队列、传输管理、元数据，然后释放前缀缓存。',
  },
  'new.prefix': {
    id: 'new.prefix',
    label: 'role_switch.py:256–284',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 256,
    endLine: 284,
    symbol: '_release_prefix_cache_for_role_switch',
    note: 'radix/hicache 前缀 reset，请求映射和 allocator clear；物理池不重分配。',
  },
  'new.failure': {
    id: 'new.failure',
    label: 'role_switch.py:124–135',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 124,
    endLine: 135,
    symbol: '_pd_role_switch_unhealthy',
    note: '拆旧/建新失败后实例 unhealthy，需要重启，没有就地回滚。',
  },
  'new.subcomponents': {
    id: 'new.subcomponents',
    label: 'role_switch.py:119–123',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/disaggregation/role_switch.py',
    startLine: 119,
    endLine: 123,
    symbol: 'init_disaggregation + _sync_disaggregation_mode_to_subcomponents',
  },
  'new.init_flags': {
    id: 'new.init_flags',
    label: 'scheduler.py:1276–1283',
    repository: SGLANG_REPOSITORY,
    commit: PD_NEW_COMMIT,
    path: 'python/sglang/srt/managers/scheduler.py',
    startLine: 1276,
    endLine: 1283,
    symbol: 'role switch state flags',
    note: 'restart、re-entrancy 与 unhealthy 三种状态分别记录。',
  },
};

export const mechanismSources: Record<string, SourceAnchor> = {
  'mechanism.match_prefix': {
    id: 'mechanism.match_prefix',
    label: 'radix_cache.py:397',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/mem_cache/radix_cache.py',
    startLine: 397,
    symbol: 'RadixCache.match_prefix',
    note: '最长前缀查询返回已有设备位置索引；树节点保存索引，不复制 K/V 数值。',
  },
  'mechanism.extend_allocate': {
    id: 'mechanism.extend_allocate',
    label: 'schedule_batch.py:2678',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/managers/schedule_batch.py',
    startLine: 2678,
    symbol: 'ScheduleBatch.prepare_for_extend',
    note: 'Extend 只准备未命中的输入部分，并为它们分配可写位置。',
  },
  'mechanism.decode_prepare': {
    id: 'mechanism.decode_prepare',
    label: 'schedule_batch.py:3470',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/managers/schedule_batch.py',
    startLine: 3470,
    symbol: 'ScheduleBatch.prepare_for_decode',
    note: '上一轮采样的 token 成为下一轮 Decode 输入；逐请求新增一个可写位置。',
  },
  'mechanism.decode_allocate': {
    id: 'mechanism.decode_allocate',
    label: 'schedule_batch.py:3510',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/managers/schedule_batch.py',
    startLine: 3510,
    symbol: 'self.out_cache_loc = alloc_for_decode',
    note: 'Decode 为本轮输入取得输出位置；分配不等于 K/V 已经写入。',
  },
  'mechanism.prefill_result': {
    id: 'mechanism.prefill_result',
    label: 'batch_result_processor.py:358',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/managers/scheduler_components/batch_result_processor.py',
    startLine: 358,
    symbol: 'process_batch_result_prefill → req.output_ids.append',
    note: 'Prefill 结果处理追加第一个输出 token；该 token 还没有自身 K/V。',
  },
  'mechanism.cache_unfinished': {
    id: 'mechanism.cache_unfinished',
    label: 'radix_cache.py:561',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/mem_cache/radix_cache.py',
    startLine: 561,
    symbol: 'RadixCache.cache_unfinished_req',
    note: '未完成请求可插入已计算前缀；缓存持有与请求引用同时存在。',
  },
  'mechanism.decode_result': {
    id: 'mechanism.decode_result',
    label: 'batch_result_processor.py:920',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/managers/scheduler_components/batch_result_processor.py',
    startLine: 920,
    symbol: 'process_batch_result_decode',
    note: 'Decode 结果处理入口；输出 token 回到请求进度，未完成则继续调度。',
  },
  'mechanism.cache_finished': {
    id: 'mechanism.cache_finished',
    label: 'radix_cache.py:479',
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    path: 'python/sglang/srt/mem_cache/radix_cache.py',
    startLine: 479,
    symbol: 'RadixCache.cache_finished_req',
    note: '完成时缓存接管可复用 KV，并释放请求槽位与缓存锁引用；物理池不清空。',
  },
};

export const allSources: Record<string, SourceAnchor> = {
  ...overviewSources,
  'overview.cache.finished': {
    id: 'overview.cache.finished', label: 'radix_cache.py:479–560',
    repository: SGLANG_REPOSITORY, commit: MAIN_COMMIT,
    path: 'python/sglang/srt/mem_cache/radix_cache.py',
    startLine: 479, endLine: 560, symbol: 'RadixCache.cache_finished_req',
    note: '缓存接管可复用 KV 的引用；释放请求引用不等于释放所有 KV。',
  },
  ...mechanismSources,
  ...versionSources,
};

export function sourceFor(id: string): SourceAnchor {
  const source = allSources[id];
  if (!source) {
    throw new Error(`Unknown source anchor: ${id}`);
  }
  return source;
}

export function overviewSourcesFor(nodeId: string): SourceAnchor[] {
  return (overviewSourceIdsByNode[nodeId] ?? []).map(sourceFor);
}
