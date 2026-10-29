import type { Accent, ModuleDoc, ProcessGroup } from '../../viewer/types';
import { overviewEvidence, overviewSourceIdsByNode } from './sources';

interface OverviewDetail {
  summary: string;
  objects: string[];
  boundaries: string[];
  accent: Accent;
  groupId: string;
}

const groupByOverviewNode: Record<string, string> = {
  api: 'entry',
  tokenizer: 'entry',
  scheduler: 'scheduler',
  execution: 'scheduler',
  cache: 'scheduler',
  model: 'scheduler',
  detokenizer: 'detokenizer',
};

const details: Record<string, OverviewDetail> = {
  api: {
    summary: '接住客户端请求，把文本与生成参数送进引擎，再把回复送回原连接。',
    objects: ['文本请求与生成参数', 'HTTP / OpenAI 兼容响应', '请求连接的等待状态'],
    boundaries: [
      '本图从文本已经送达实例开始，不展开外部网关和负载均衡。',
      'HTTP 接入、调度执行与设备计算处在不同边界；接入层不是调度器。',
    ],
    accent: 'cyan',
    groupId: groupByOverviewNode.api,
  },
  tokenizer: {
    summary: '把输入组织成带 rid 与 token ID 的请求，交给调度进程；并保留前端等待状态。',
    objects: [
      'TokenizedGenerateReqInput（含 rid、token ID 与生成配置）',
      '入口侧请求等待状态',
      '回程的 BatchStrOutput',
    ],
    boundaries: [
      'rid 用来找到原请求；它不是 GPU 里的一段 KV 张量。',
      '输入分词在入口进程完成；输出反分词由独立 DetokenizerManager 处理。',
    ],
    accent: 'cyan',
    groupId: groupByOverviewNode.tokenizer,
  },
  scheduler: {
    summary: '决定本轮让哪些请求执行多少 token，并处理结果、结束状态与输出。',
    objects: ['等待中的请求', 'ScheduleBatch', '结果处理后的输出 token ID'],
    boundaries: [
      'Scheduler、KV 管理与 Worker/Runner 在调度进程内协作，不是串行微服务。',
      '未结束的请求会继续参与后续调度，不会被当成已完成。',
    ],
    accent: 'amber',
    groupId: groupByOverviewNode.scheduler,
  },
  execution: {
    summary: '把本轮批次转成可执行 ForwardBatch，调用模型并采样下一 token。',
    objects: ['TpModelWorker', 'ForwardBatch', 'next_token_ids / sample 结果'],
    boundaries: [
      'TpModelWorker 与 ModelRunner 是调度进程内的对象，不是两个独立服务。',
      '模型算子调用发生在同一调度进程内；这里没有跨服务 RPC。',
    ],
    accent: 'coral',
    groupId: groupByOverviewNode.execution,
  },
  cache: {
    summary: '匹配可复用的前缀，并管理请求位置与可写槽位；实际 K/V 值在设备 buffer。',
    objects: [
      'RadixCache 前缀索引（本图示例）',
      'req_to_token_pool 请求—位置映射',
      'token_to_kv_pool_allocator 的分配状态',
      '设备 buffer 中的 K/V 张量',
    ],
    boundaries: [
      '前缀树不是存放全部 KV 张量的独立服务器。',
      '请求引用和 KV 数据不是同一种网络载荷；不要把光点当作 KV 传输。',
      '缓存树和 allocator 是管理结构；物理 token KV pool 是设备资源。',
    ],
    accent: 'lilac',
    groupId: groupByOverviewNode.cache,
  },
  model: {
    summary: '执行具体的模型结构与 Attention 后端 kernel；本图以 DeepSeek-V3 类为源码示例。',
    objects: [
      'DeepseekV3ForCausalLM（源码示例）',
      'Attention、线性层等模型结构',
      '由 ModelRunner 选择的 Attention backend kernel',
    ],
    boundaries: [
      '模型层、Attention 后端与运行的 GPU 设备不是三个服务。',
      '源码锚点使用一个模型类作示例，不代表所有模型共用完全相同的实现。',
    ],
    accent: 'mint',
    groupId: groupByOverviewNode.model,
  },
  detokenizer: {
    summary: '把输出 token ID 按各请求的增量状态还原成文本，再由入口侧完成回告。',
    objects: [
      'BatchTokenIDOutput',
      '每个请求的增量解码状态',
      '回送 TokenizerManager 的 BatchStrOutput',
    ],
    boundaries: [
      'DetokenizerManager 是独立进程，但不是另一个模型服务。',
      '它不负责输入分词，也不直接持有客户端 HTTP 连接。',
    ],
    accent: 'amber',
    groupId: groupByOverviewNode.detokenizer,
  },
};

export const processGroups: ProcessGroup[] = [
  {
    id: 'entry',
    label: '入口进程',
    kind: 'process',
    detail: 'HTTP / OpenAI API 与 TokenizerManager 在入口侧。',
  },
  {
    id: 'scheduler',
    label: '调度进程',
    kind: 'process',
    detail: 'Scheduler、KV 管理、TpModelWorker 与 ModelRunner 协作。',
  },
  {
    id: 'detokenizer',
    label: '反分词进程',
    kind: 'process',
    detail: 'DetokenizerManager 独立处理输出文字化。',
  },
  {
    id: 'gpu',
    label: 'GPU 设备',
    kind: 'device',
    detail: '计算与 KV 值所在的资源边界，不是另一个服务进程。',
  },
];

const overviewModules: Record<string, ModuleDoc> = Object.fromEntries(
  overviewEvidence.nodes.map((node) => {
    const detail = details[node.id];
    if (!detail) {
      throw new Error(`Missing readable detail for overview node ${node.id}`);
    }
    return [
      node.id,
      {
        id: node.id,
        title: node.title,
        name: node.name,
        directory: node.directory,
        groupId: detail.groupId,
        accent: detail.accent,
        summary: detail.summary,
        why: node.why,
        action: node.action,
        objects: detail.objects,
        boundaries: detail.boundaries,
        sourceIds: overviewSourceIdsByNode[node.id],
      } satisfies ModuleDoc,
    ];
  }),
);

function pdModule(
  module: Omit<ModuleDoc, 'groupId' | 'directory'> & {
    groupId?: string;
    directory?: string;
  },
): ModuleDoc {
  return {
    groupId: module.groupId ?? 'scheduler',
    directory: module.directory ?? 'disaggregation/ · managers/ · entrypoints/',
    ...module,
  };
}

const pdModules: Record<string, ModuleDoc> = {
  'pd.legacy_loop': pdModule({
    id: 'pd.legacy_loop',
    title: '旧版固定循环入口',
    name: 'dispatch_event_loop',
    directory: 'managers/scheduler.py',
    accent: 'rose',
    summary:
      'v0.5.20 的调度进程按启动时角色直接选择普通、overlap 或 PP 循环；没有本场景的运行时重分派 supervisor。',
    why: '理解缺失的路径，才能把“无管理 API”与“无 PD/PDMux 能力”区分开。',
    action:
      'dispatch_event_loop 读取当前 disaggregation_mode，直接进入对应角色循环。固定 commit 的 http_server.py 中未发现 /pd_role_switch，scheduler.py 中未发现 PdRoleSwitchReqInput 或 run_event_loop_supervisor。',
    objects: ['启动时的 disaggregation_mode', '角色对应的普通 / overlap / PP 循环'],
    boundaries: [
      '旧版仍有 PD 与 PDMux；此管理 API 与 supervisor 路径不可用。',
      '不要把“没有此管理 API”讲成“旧版不支持 PD 或混部”。',
      '不在图中演出虚构的 404 网络请求或重启耗时。',
    ],
    sourceIds: ['old.dispatch', 'old.http_file'],
  }),
  'pd.http': pdModule({
    id: 'pd.http',
    title: '管理 API 入口',
    name: 'POST /pd_role_switch',
    directory: 'entrypoints/http_server.py',
    groupId: 'entry',
    accent: 'coral',
    summary:
      'v0.5.21 新增的运行时管理入口，将角色切换请求交给 TokenizerManager。',
    why: '运维不再需要凭启动参数决定本实例的 PD 角色。',
    action:
      'HTTP 端点接收 PdRoleSwitchReqInput；success 决定响应为 200 还是 400。管理权限与自动排空是两件事。',
    objects: ['PdRoleSwitchReqInput', 'PdRoleSwitchReqOutput', 'HTTP 200 / 400'],
    boundaries: [
      '有在途请求时 API 只负责拒绝；外部编排需要先完成摘流与排空。',
      '旧版没有这个端点，但这不代表旧版没有 PD/PDMux。',
    ],
    sourceIds: ['new.http', 'old.http_file'],
  }),
  'pd.scheduler': pdModule({
    id: 'pd.scheduler',
    title: 'Scheduler 控制请求',
    name: 'PdRoleSwitchReqInput → handle_pd_role_switch',
    accent: 'amber',
    summary:
      '调度进程的控制请求分发器接收切换输入，并在结果发出后退出旧角色循环。',
    why: '角色切换需要影响长期运行的 event loop，而不是只改一个状态字段。',
    action:
      'Scheduler 的请求分发表登记 handle_pd_role_switch；成功响应后检查 _event_loop_should_restart 并抛出 PdRoleSwitchRestart。',
    objects: ['控制请求输入', 'PdRoleSwitchReqOutput', '_event_loop_should_restart'],
    boundaries: [
      'HTTP 只完成协议接入；真正的角色拆建和循环重分派在调度进程内。',
      '成功响应先发回，随后旧循环才退出。',
    ],
    sourceIds: [
      'new.scheduler_dispatch',
      'new.scheduler_handle',
      'new.restart',
      'new.init_flags',
    ],
  }),
  'pd.guard': pdModule({
    id: 'pd.guard',
    title: '切换门槛',
    name: '_reject_reason',
    accent: 'lilac',
    summary:
      '表驱动的前置检查按顺序返回第一个失败原因，决定能否进入空闲检查和拆建。',
    why: '避免在未开启、重入、角色非法、PD 未启用、后端不支持或 staging 开启时破坏实例。',
    action:
      '检查 --enable-pd-role-switch、unhealthy、重入、目标角色、PD 模式、传输后端能力与 staging buffer；通过后再检查同角色、空闲与 Graph 门槛。',
    objects: [
      '服务启动参数',
      '当前 KV manager 与传输后端能力',
      'safe_to_restore 标志',
    ],
    boundaries: [
      '前置条件不是性能保证，也不代表外部已排空。',
      '本模拟不展开全部输入校验的实现细节。',
    ],
    sourceIds: ['new.reject', 'new.idle', 'new.same_role'],
  }),
  'pd.idle': pdModule({
    id: 'pd.idle',
    title: '空闲检查',
    name: 'is_fully_idle',
    accent: 'rose',
    summary:
      '切换前必须完全空闲；有在途请求时会拒绝，而不是自动帮忙排空。',
    why: '在请求仍占用队列、KV 位置或状态时拆角色结构不安全。',
    action:
      '角色或 Graph 检查通过后调用 scheduler.is_fully_idle()。不空闲则返回失败、safe_to_restore=True，且不执行 teardown。',
    objects: ['在途生成请求', '队列表与运行状态', 'safe_to_restore'],
    boundaries: [
      '外部排空发生在 API 之外；管理 API 不自动摘流。',
      'safe_to_restore 是响应标志，不代表已经自动恢复路由。',
    ],
    sourceIds: ['new.idle', 'new.reject'],
  }),
  'pd.graph': pdModule({
    id: 'pd.graph',
    title: 'Graph 余量门槛',
    name: 'decode_cuda_graph_memory_gb',
    accent: 'lilac',
    summary:
      '切到 Decode 且尚无 Decode CUDA graph 时，需要先声明内存并检查设备余量。',
    why: 'Graph 捕获需要可用的设备内存；检查失败应在拆旧之前停止。',
    action:
      '检查 required_graph_gb 是否为非负、读取可用显存量并比较；通过后才进入拆旧与重建。延后捕获失败只降级为 eager。',
    objects: ['decode_cuda_graph_memory_gb', '可用显存查询', 'decode graph batch size'],
    boundaries: [
      '本例明确假定 Graph 前置余量检查通过，不模拟捕获步骤。',
      'Graph 捕获失败不等同于拆除/重建失败。',
    ],
    sourceIds: ['new.graph', 'new.graph_deferred'],
  }),
  'pd.teardown': pdModule({
    id: 'pd.teardown',
    title: '拆除旧角色结构',
    name: 'teardown_disaggregation',
    accent: 'amber',
    summary:
      '释放当前角色专属的队列、传输管理、元数据与映射，为翻转和重建让路。',
    why: '旧角色的传输队列与元数据不能和新角色的结构同时存活。',
    action:
      'Prefill 侧释放 bootstrap 与 inflight 队列；Decode 侧释放 prealloc / transfer 队列并关闭接收 socket；清 metadata buffer 与索引分配器。',
    objects: ['角色队列', 'KV transfer manager', 'metadata buffers', '请求映射'],
    boundaries: [
      '物理 token KV pool 不在拆除范围内。',
      '拆除 + 翻转 + 重建被视为一个逻辑原子步骤，但失败时不自动回滚。',
    ],
    sourceIds: ['new.teardown', 'new.teardown_rebuild'],
  }),
  'pd.prefix': pdModule({
    id: 'pd.prefix',
    title: '前缀与映射释放',
    name: '_release_prefix_cache_for_role_switch',
    accent: 'lilac',
    summary:
      '角色切换不是热前缀续命：缓存树会 reset，实例若使用 hicache 还会尽力清后端。',
    why: '跨越角色复用旧前缀会带来语义错误与槽位泄漏风险。',
    action:
      '启用 radix/hicache 时 reset tree cache，并清空 req_to_token_pool 和 token_to_kv_pool_allocator；--disable-radix-cache 分支无需释放持久前缀。',
    objects: ['tree_cache', 'hicache 存储后端', 'req_to_token_pool', 'allocator'],
    boundaries: [
      '不能宣称热前缀在切换后保留。',
      '前缀树不是全部 KV 值；物理池仍保留容量与设备存储。',
    ],
    sourceIds: ['new.prefix', 'new.role_file'],
  }),
  'pd.pool': pdModule({
    id: 'pd.pool',
    title: '物理 token KV pool',
    name: 'role-independent KV pool',
    accent: 'mint',
    summary:
      '角色无关的物理 KV 池不会因角色翻转重新分配；改变的是角色结构、缓存索引与占用状态。',
    why: '区分物理池与逻辑占用，才能理解“保池但清 occupancy”。',
    action:
      'teardown 后 allocator 与请求映射被清理，物理池仍由设备持有；新角色在同一边界内重新建立管理结构。',
    objects: ['设备上的 token KV pool', 'allocator 的占用状态', '请求到 token 的映射'],
    boundaries: [
      '物理池保留不等于 KV 内容或前缀语义在角色间有效。',
      '本图不展示设备地址、容量数字或实际显存占用。',
    ],
    sourceIds: ['new.role_file', 'new.prefix'],
  }),
  'pd.rebuild': pdModule({
    id: 'pd.rebuild',
    title: '翻转与重建',
    name: 'init_disaggregation + sync',
    accent: 'cyan',
    summary:
      '角色覆盖为 prefill/decode 后初始化新角色的 disaggregation 结构，并同步子组件。',
    why: '新角色需要全新的队列与传输方向，旧结构不能直接复用。',
    action:
      'teardown 后覆盖 role_switch.flip，调用 scheduler.init_disaggregation()，再执行 _sync_disaggregation_mode_to_subcomponents()。',
    objects: ['新的 disaggregation_mode', '新角色队列', '同步后的子组件'],
    boundaries: [
      '拆除/重建异常会留下半拆状态，标记 unhealthy；没有就地回滚。',
      'Decode Graph 捕获是后续 best-effort 步骤，不在本场景展开。',
    ],
    sourceIds: ['new.teardown_rebuild', 'new.subcomponents'],
  }),
  'pd.supervisor': pdModule({
    id: 'pd.supervisor',
    title: '循环重分派',
    name: 'run_event_loop_supervisor',
    accent: 'cyan',
    summary:
      '切换成功后旧角色循环退出，supervisor 捕获重启信号并重新分派到新角色循环。',
    why: '角色变了，长期 event loop 也必须换成对应角色的循环。',
    action:
      'Scheduler 设置 _event_loop_should_restart；成功响应发出后抛出 PdRoleSwitchRestart；supervisor 的 while True 捕获后再次 dispatch。',
    objects: ['PdRoleSwitchRestart', '_event_loop_should_restart', '新的 event loop'],
    boundaries: [
      '这是运行时重分派，不是进程重启。',
      '旧版直接 dispatch，没有这个 supervisor 路径。',
    ],
    sourceIds: ['new.supervisor', 'new.restart', 'new.dispatch'],
  }),
  'pd.health': pdModule({
    id: 'pd.health',
    title: '失败后置状态',
    name: '_pd_role_switch_unhealthy',
    accent: 'rose',
    summary:
      '拆除旧角色后若新角色重建失败，实例进入 unhealthy 状态，需要重启。',
    why: '旧结构已释放、新结构未就绪时，实例不能再安全服务。',
    action:
      '捕获 teardown/flip/rebuild 异常，将 _pd_role_switch_unhealthy 置为 True，返回失败并说明 restart required。',
    objects: ['_pd_role_switch_unhealthy', '失败响应', '重启要求'],
    boundaries: [
      '没有自动回滚或自动重建成功保证。',
      '后续切换会被健康检查直接拒绝。',
    ],
    sourceIds: ['new.failure', 'new.reject'],
  }),
};

export const moduleDocs: Record<string, ModuleDoc> = {
  ...overviewModules,
  ...pdModules,
};

export function moduleDoc(id: string): ModuleDoc {
  const module = moduleDocs[id];
  if (!module) {
    throw new Error(`Unknown module: ${id}`);
  }
  return module;
}
