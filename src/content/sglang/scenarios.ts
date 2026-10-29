import type {
  ChangeEntry,
  Condition,
  LaneDefinition,
  LaneFact,
  ScenarioDefinition,
  ViewerStep,
} from '../../viewer/types';
import {
  MAIN_COMMIT,
  PD_NEW_COMMIT,
  PD_OLD_COMMIT,
  SGLANG_REPOSITORY,
  overviewSourceIdsByNode,
} from './sources';

const OVERVIEW_STEP_MODULE_IDS = [
  'api',
  'tokenizer',
  'scheduler',
  'execution',
  'cache',
  'model',
  'detokenizer',
];

const mainLane: LaneDefinition = {
  id: 'main',
  label: '普通生成基线',
  version: 'main 基线',
  commit: MAIN_COMMIT,
  shortCommit: MAIN_COMMIT.slice(0, 10),
  status: '固定源码基线',
  note: '普通 Python 文本生成、单卡合并部署、普通非 overlap 循环。',
  available: true,
  accent: 'cyan',
};

const legacyLane: LaneDefinition = {
  id: 'v0520',
  label: 'v0.5.20',
  version: 'v0.5.20',
  commit: PD_OLD_COMMIT,
  shortCommit: PD_OLD_COMMIT.slice(0, 10),
  status: '此管理 API 与 supervisor 路径不可用',
  note: '旧版仍有 PD 与 PDMux；本场景只比较 POST /pd_role_switch 与对应的 supervisor 重分派路径。',
  available: false,
  accent: 'rose',
};

const modernLane: LaneDefinition = {
  id: 'v0521',
  label: 'v0.5.21',
  version: 'v0.5.21',
  commit: PD_NEW_COMMIT,
  shortCommit: PD_NEW_COMMIT.slice(0, 10),
  status: '包含运行时角色切换路径',
  note: '管理 API、前置检查、拆旧/建新、supervisor 与失败后置状态都已核对。',
  available: true,
  accent: 'mint',
};

function legacyFact(detail?: string): LaneFact {
  return {
    status: '此管理 API 与 supervisor 路径不可用',
    tone: 'blocked',
    detail:
      detail ??
      'v0.5.20 固定文件没有 /pd_role_switch 与 run_event_loop_supervisor。旧版仍有 PD 与 PDMux；这里不把缺失的管理路径扩展成“无 PD 能力”。',
  };
}

function branchFact(
  status: string,
  tone: LaneFact['tone'],
  detail: string,
): LaneFact {
  return { status, tone, detail };
}

const commonChanges: ChangeEntry[] = [
  {
    moduleId: 'pd.http',
    label: 'HTTP 管理入口',
    oldState: '固定文件中没有此端点',
    newState: 'POST /pd_role_switch',
    tone: 'added',
  },
  {
    moduleId: 'pd.scheduler',
    label: 'Scheduler 控制分发',
    oldState: '按启动角色直接进入循环',
    newState: '控制请求 + 循环重启信号',
    tone: 'added',
  },
  {
    moduleId: 'pd.guard',
    label: '前置检查',
    oldState: '无此运行时检查表',
    newState: '开关、健康、重入、模式、后端、staging',
    tone: 'guarded',
  },
  {
    moduleId: 'pd.idle',
    label: '空闲条件',
    oldState: '无此管理路径',
    newState: '有在途请求则拒绝，不拆结构',
    tone: 'guarded',
  },
  {
    moduleId: 'pd.teardown',
    label: '旧角色拆除',
    oldState: '无此管理路径',
    newState: '队列、传输管理、元数据拆除',
    tone: 'changed',
  },
  {
    moduleId: 'pd.prefix',
    label: '前缀与映射',
    oldState: '无此管理路径',
    newState: '缓存树 reset，allocator clear',
    tone: 'changed',
  },
  {
    moduleId: 'pd.pool',
    label: '物理 KV 池',
    oldState: '物理池原本存在',
    newState: '同一物理池保留，不重分配',
    tone: 'changed',
  },
  {
    moduleId: 'pd.rebuild',
    label: '目标角色重建',
    oldState: '无此管理路径',
    newState: 'role flip + init + sync',
    tone: 'added',
  },
  {
    moduleId: 'pd.supervisor',
    label: '循环 supervisor',
    oldState: '固定文件无此路径',
    newState: '捕获重启并重分派',
    tone: 'added',
  },
  {
    moduleId: 'pd.health',
    label: '失败后置状态',
    oldState: '无此管理路径',
    newState: 'unhealthy，需要重启，无就地回滚',
    tone: 'guarded',
  },
];

const basePassConditions: Condition[] = [
  {
    id: 'switch-enabled',
    label: '--enable-pd-role-switch 已开启',
    status: 'pass',
    detail: '未开启时 _reject_reason 首先拒绝。',
    sourceIds: ['new.reject'],
  },
  {
    id: 'healthy',
    label: '实例健康，且没有切换进行中',
    status: 'pass',
    detail: 'unhealthy 或重入会在进入拆建前被拒绝。',
    sourceIds: ['new.reject', 'new.init_flags'],
  },
  {
    id: 'target',
    label: '目标角色合法且不同于当前角色',
    status: 'pass',
    detail: '目标相同会直接返回 already in target role，不执行拆建。',
    sourceIds: ['new.same_role'],
  },
  {
    id: 'pd-mode',
    label: '实例运行在 PD 模式',
    status: 'pass',
    detail: 'DisaggregationMode 不能是 NULL。',
    sourceIds: ['new.reject'],
  },
  {
    id: 'backend',
    label: '传输后端支持运行时切换',
    status: 'pass',
    detail: '由当前角色的 kv_manager 能力决定。',
    sourceIds: ['new.reject'],
  },
  {
    id: 'staging',
    label: '未启用 staging buffer',
    status: 'pass',
    detail: 'SGLANG_DISAGG_STAGING_BUFFER 与运行时切换不兼容。',
    sourceIds: ['new.reject'],
  },
];

function drainCondition(status: Condition['status']): Condition {
  return {
    id: 'external-drain',
    label: '外部编排已摘流并排空',
    status,
    detail:
      '这是 API 之外的条件。管理 API 不自动排空；它只会在空闲检查处拒绝仍忙的实例。',
    sourceIds: ['new.idle'],
  };
}

function idleCondition(status: Condition['status']): Condition {
  return {
    id: 'idle',
    label: 'is_fully_idle() 通过',
    status,
    detail:
      status === 'fail'
        ? '仍有在途请求；返回失败与 safe_to_restore=True，不进入 teardown。'
        : '拆旧前再次确认实例完全空闲。',
    sourceIds: ['new.idle'],
  };
}

const graphCondition: Condition = {
  id: 'graph-headroom',
  label: 'Decode CUDA graph 余量检查（本例假定通过）',
  status: 'assumed',
  detail:
    '切到 Decode 且尚无 graph 时需声明所需内存并检查余量。本教学场景明确假定通过，不模拟 Graph 捕获。',
  sourceIds: ['new.graph', 'new.graph_deferred'],
};

function checkpoint(): Condition {
  return {
    id: 'external-drain',
    label: '外部编排已摘流并排空',
    status: 'pass',
    detail:
      '这是 API 之外的控制面动作。图中不把外部摘流画成管理 API 内自动执行。',
    sourceIds: ['new.idle'],
  };
}

const normalSteps: ViewerStep[] = [
  {
    id: 'drain',
    label: '外部排空',
    title: '外部编排先完成排空',
    summary:
      '目标实例此刻完全空闲。这一步发生在受控管理 API 之外，不代表 /pd_role_switch 会自己摘流或排空。',
    points: [
      '该场景是“一台 P 已由外部排空，准备运行时切换为 D”。',
      '后续 API 内的 is_fully_idle() 仍会再次确认。',
    ],
    moduleIds: ['pd.idle', 'pd.pool'],
    sourceIds: ['new.idle'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '外部条件已满足',
        'assumed',
        '外部编排完成摘流与排空；本图将其画成 API 之外的维护动作。',
      ),
    },
  },
  {
    id: 'invoke',
    label: '请求切换',
    title: '管理 API 接到角色切换请求',
    summary:
      'POST /pd_role_switch 把目标角色和（必要时）Decode Graph 需求交给 TokenizerManager，随后转入 Scheduler。',
    points: [
      'v0.5.20 固定文件中没有这个管理端点。',
      '请求包含目标角色；切 Decode 时还可能携带 decode CUDA graph 相关参数。',
    ],
    moduleIds: ['pd.http', 'pd.scheduler'],
    sourceIds: ['new.http', 'new.scheduler_dispatch', 'new.scheduler_handle'],
    laneFacts: {
      v0520: legacyFact('这里没有可对齐的管理请求路径；不演出虚构的 404 往返。'),
      v0521: branchFact(
        '控制请求已到达',
        'available',
        'HTTP 管理入口调用 TokenizerManager，最后进入 Scheduler 的控制请求分发。',
      ),
    },
  },
  {
    id: 'guard',
    label: '前置检查',
    title: '门槛、空闲与 Graph 条件通过',
    summary:
      '表驱动检查通过，实例空闲，目标 Decode 的 Graph 余量本例假定通过。任何一个失败都应在拆旧前停止。',
    points: [
      '健康、重入、目标角色、PD 模式、后端能力和 staging 都会先被检查。',
      '空闲检查之后才检查 Decode Graph 余量；捕获本身不在本场景展开。',
    ],
    moduleIds: ['pd.guard', 'pd.idle', 'pd.graph'],
    sourceIds: ['new.reject', 'new.idle', 'new.graph'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '检查通过',
        'available',
        '所有拆建前条件满足；Graph 前置余量按明确假设通过。',
      ),
    },
  },
  {
    id: 'teardown',
    label: '拆除旧角色',
    title: '旧结构拆除，前缀释放，物理池保留',
    summary:
      '角色队列、传输管理和元数据被释放；前缀缓存树 reset，请求映射和 allocator clear。物理 token KV pool 不重分配。',
    points: [
      '前缀缓存 release 不等于物理 KV pool 被销毁。',
      '此步结束前角色仍可能保留旧值，真正的 role 覆盖发生在随后重建阶段。',
    ],
    moduleIds: ['pd.teardown', 'pd.prefix', 'pd.pool'],
    sourceIds: ['new.teardown', 'new.prefix', 'new.role_file'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '旧结构已拆除',
        'changed',
        '旧角色队列、传输管理、元数据和映射被释放；缓存前缀 reset，allocator 清空；物理池保留。',
      ),
    },
  },
  {
    id: 'rebuild',
    label: '建立新角色',
    title: '翻转目标角色，重建新结构',
    summary:
      '角色覆盖为 Decode，初始化新的 disaggregation 结构并同步到子组件。失败点会直接决定实例是否 unhealthy。',
    points: [
      '正常路径中，新结构建立成功。',
      '失败路径中，旧结构已拆、新结构未就绪时没有就地回滚。',
    ],
    moduleIds: ['pd.rebuild', 'pd.pool'],
    sourceIds: ['new.subcomponents', 'new.teardown_rebuild', 'new.role_file'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        'Decode 结构已建立',
        'available',
        '新角色结构建立并同步；物理池仍在原处。Decode Graph 捕获细节不展开。',
      ),
    },
  },
  {
    id: 'supervise',
    label: '重新服务',
    title: 'Supervisor 重分派，以 Decode 继续服务',
    summary:
      '成功响应后旧循环退出，supervisor 捕获重启信号并把调度进程重新分派到新角色的 event loop。',
    points: [
      '角色重分派发生在同一调度进程内，不是进程重启。',
      'v0.5.20 没有这条 supervisor 路径；它按启动角色直接选择循环。',
    ],
    moduleIds: ['pd.supervisor', 'pd.rebuild'],
    sourceIds: [
      'new.restart_flag',
      'new.supervisor',
      'new.restart',
      'new.dispatch',
    ],
    laneFacts: {
      v0520: legacyFact(
        '旧版按启动时的角色直接 dispatch。没有 supervisor 重分派路径。',
      ),
      v0521: branchFact(
        '已以 Decode 角色重分派',
        'available',
        '旧循环以 PdRoleSwitchRestart 退出；supervisor 捕获后重新分派到 Decode 循环。',
      ),
    },
  },
];

const busySteps: ViewerStep[] = [
  {
    id: 'busy',
    label: '仍有请求',
    title: '实例仍在服务，存在在途请求',
    summary:
      '外部尚未完成摘流/排空。运行中的请求仍占用调度状态和 KV 位置；场景在这一条件下尝试发起切换。',
    points: [
      '在途请求是拒绝条件，不应被 API 自动“挪走”。',
      '图中请求与设备池保持可见，以便观察拒绝后的保留状态。',
    ],
    moduleIds: ['pd.idle', 'pd.pool'],
    sourceIds: ['new.idle'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '存在在途请求',
        'blocked',
        '请求仍在运行；实例不满足完全空闲。',
      ),
    },
  },
  {
    id: 'invoke-busy',
    label: '请求切换',
    title: '切换请求仍可到达管理入口',
    summary:
      '管理 API 不先拒绝协议层；它把控制请求交给 Scheduler，随后由空闲检查决定结果。',
    points: ['入口到达不等于通过门槛。', '外部排空与 API 内检查必须分开理解。'],
    moduleIds: ['pd.http', 'pd.scheduler'],
    sourceIds: ['new.http', 'new.scheduler_handle'],
    laneFacts: {
      v0520: legacyFact('旧侧没有可对齐的管理 API 请求路径。'),
      v0521: branchFact(
        '控制请求已到达',
        'available',
        'HTTP 管理入口将请求交给 Scheduler 控制路径。',
      ),
    },
  },
  {
    id: 'rejected',
    label: '忙碌拒绝',
    title: '空闲检查拒绝，结构原地保留',
    summary:
      'is_fully_idle() 返回 false，切换在 teardown 之前失败。新角色未被建立，旧角色结构、在途请求和物理池都没有被角色切换拆除。',
    points: [
      '返回 safe_to_restore=True，但外部路由是否恢复由编排侧处理，API 不自动恢复。',
      '拒绝发生在 Graph 余量检查之前，因此 Graph 分支在本例被跳过。',
    ],
    moduleIds: ['pd.idle', 'pd.guard', 'pd.teardown', 'pd.pool'],
    sourceIds: ['new.idle', 'new.reject'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '拒绝：实例不空闲',
        'blocked',
        '在途请求仍占用结构；没有 teardown，没有 role flip，也没有新角色构建。',
      ),
    },
  },
];

const failureSteps: ViewerStep[] = [
  {
    id: 'drained',
    label: '外部排空',
    title: '外部排空完成，准备拆建',
    summary:
      '外部编排完成摘流和排空。这里选择一个“重建阶段失败”的固定分支：拆旧成功后，新角色初始化抛出异常。',
    points: [
      '失败点被限定在新角色重建阶段，便于展示 unhealthy 的后果。',
      '不表示每次切换都会失败，也不虚构失败耗时。',
    ],
    moduleIds: ['pd.idle', 'pd.pool'],
    sourceIds: ['new.idle', 'new.teardown_rebuild'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact('外部条件已满足', 'assumed', '实例已完成外部摘流与排空。'),
    },
  },
  {
    id: 'invoke-failure',
    label: '请求切换',
    title: '管理 API 接到切换请求',
    summary:
      '控制请求到达 Scheduler。切换失败分支与正常分支在入口处相同，差异从拆建阶段开始。',
    moduleIds: ['pd.http', 'pd.scheduler'],
    sourceIds: ['new.http', 'new.scheduler_handle'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '控制请求已到达',
        'available',
        '入口与正常切换相同；此时尚未拆除任何结构。',
      ),
    },
  },
  {
    id: 'guards-pass',
    label: '前置检查',
    title: '前置门槛通过',
    summary:
      '空闲检查通过，Graph 前置余量按明确假设通过。失败尚未发生；这证明 unhealthy 的状态不是由 busy 拒绝造成。',
    moduleIds: ['pd.guard', 'pd.idle', 'pd.graph'],
    sourceIds: ['new.reject', 'new.idle', 'new.graph'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '检查通过',
        'available',
        '实例健康和空闲条件均满足；Graph 前置余量按假设通过。',
      ),
    },
  },
  {
    id: 'teardown-ok',
    label: '拆除旧角色',
    title: '旧结构拆除完成',
    summary:
      '旧角色队列、传输管理、元数据、前缀树与映射已释放。物理池仍在；此时尚未建立可服务的新角色。',
    points: ['前缀已被 reset；不能把这次切换描述为热前缀保留。'],
    moduleIds: ['pd.teardown', 'pd.prefix', 'pd.pool'],
    sourceIds: ['new.teardown', 'new.prefix', 'new.role_file'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '旧结构已拆除',
        'changed',
        '旧角色结构已释放；物理 KV 池保持不重分配。',
      ),
    },
  },
  {
    id: 'rebuild-failed',
    label: '重建失败',
    title: '新角色重建异常：实例 unhealthy',
    summary:
      '新角色初始化异常。teardown + flip + rebuild 的逻辑原子步骤失败后，实例被标记 unhealthy，需要重启；没有就地回滚，旧结构也不会自动复原。',
    points: [
      '旧结构已释放，新结构未就绪；failed 的不只是响应，而是实例可服务性。',
      '之后的运行时切换会被健康检查拒绝。本图不演出自动重启。',
    ],
    moduleIds: ['pd.rebuild', 'pd.health', 'pd.pool'],
    sourceIds: ['new.failure', 'new.teardown_rebuild', 'new.reject', 'new.init_flags'],
    laneFacts: {
      v0520: legacyFact(),
      v0521: branchFact(
        '重建失败 · unhealthy',
        'halted',
        '旧角色已拆、新角色未建立；物理池仍在，无就地回滚。返回失败并要求重启。',
      ),
    },
  },
];

const normalConditions: Condition[] = [
  ...basePassConditions,
  checkpoint(),
  idleCondition('pass'),
  graphCondition,
];

const busyConditions: Condition[] = [
  ...basePassConditions,
  drainCondition('fail'),
  idleCondition('fail'),
  {
    id: 'graph-headroom',
    label: 'Decode CUDA graph 余量检查',
    status: 'skipped',
    detail: '忙碌拒绝发生在 Graph 检查之前，因此本例不执行该检查。',
    sourceIds: ['new.idle', 'new.graph'],
  },
];

const failureConditions: Condition[] = [
  ...basePassConditions,
  checkpoint(),
  idleCondition('pass'),
  graphCondition,
  {
    id: 'rebuild',
    label: '拆除 + 翻转 + 重建没有异常',
    status: 'fail',
    detail:
      '本分支选择一个重建阶段异常。异常会设置 unhealthy，要求重启，无就地回滚。',
    sourceIds: ['new.failure', 'new.teardown_rebuild'],
  },
];

export const readOnlyConditions: Condition[] = [
  {
    id: 'old-scope',
    label: 'v0.5.20 对比范围',
    status: 'fail',
    detail:
      '此管理 API 与 supervisor 路径不可用；旧版仍有 PD 与 PDMux，不能扩展为“没有 PD 能力”。',
    sourceIds: ['old.dispatch', 'old.http_file'],
  },
  {
    id: 'old-dispatch',
    label: '旧侧按启动角色直接选择循环',
    status: 'fail',
    detail:
      '完整调度路径中没有 run_event_loop_supervisor；这里不进行同一管理 API 的左右同步执行。',
    sourceIds: ['old.dispatch'],
  },
];

export const compareScenarios: ScenarioDefinition[] = [
  {
    id: 'normal',
    label: '正常切换',
    summary:
      '外部排空后，经管理 API、前置检查、拆旧与重建，由 supervisor 重分派到 Decode。物理池保留，前缀缓存释放。',
    steps: normalSteps,
    conditions: normalConditions,
    changes: commonChanges,
    note: 'Decode Graph 余量按假设通过；图中不模拟 Graph 捕获和外部摘流耗时。',
  },
  {
    id: 'busy',
    label: '忙时拒绝',
    summary:
      '存在在途请求时空闲检查拒绝。没有 teardown、role flip 或新角色结构；请求、旧结构和物理池保持原状。',
    steps: busySteps,
    conditions: busyConditions,
    changes: commonChanges,
    note: 'safe_to_restore=True 是返回提示；是否恢复外部路由由编排侧决定。',
  },
  {
    id: 'failed',
    label: '重建失败',
    summary:
      '外部排空与前置检查通过，旧结构拆除后新角色重建异常。实例 unhealthy，需要重启，没有就地回滚；物理池保留。',
    steps: failureSteps,
    conditions: failureConditions,
    changes: commonChanges,
    note: '失败点固定为重建异常；不模拟 Graph 捕获失败，也不演出自动重启。',
  },
];

export const overviewSceneData = {
  id: 'overview',
  navLabel: '系统总览',
  title: '一套引擎，三种边界',
  kicker: 'SGLang / 普通请求地图',
  description:
    '入口侧、调度进程与独立反分词进程共同协作；GPU 是设备资源，不是另一个服务。点击节点或标签查看职责、对象、边界与固定源码。',
  mode: 'explore' as const,
  instructions:
    '这是固定源码基线的系统地图，不复用 PD 对比的版本。点击 3D 节点、悬浮标签或下方节点索引查看模块档案。',
  lanes: [mainLane],
  scenarios: [
    {
      id: 'atlas',
      label: '系统地图',
      summary:
        '普通 Python 文本生成、单卡合并部署、普通非 overlap 循环。进程关系不能平铺成严格串行流水线；KV 管理与执行存在协作依赖。',
      steps: [
        {
          id: 'map',
          label: '边界',
          title: '先看进程，再看数据',
          summary:
            'HTTP 与 TokenizerManager 在入口侧；Scheduler、KV 管理、TpModelWorker 与 ModelRunner 在调度进程内协作；Detokenizer 是独立进程；GPU 是设备资源。',
          points: [
            '请求链路是教学化排序，不代表真实毫秒或严格串行部署。',
            '请求引用与设备中的 KV 数据不是同一种网络载荷。',
          ],
          moduleIds: OVERVIEW_STEP_MODULE_IDS,
          sourceIds: OVERVIEW_STEP_MODULE_IDS.flatMap(
            (moduleId) => overviewSourceIdsByNode[moduleId] ?? [],
          ),
        },
      ],
    },
  ],
};

export const requestFlowSceneData = {
  id: 'request-flow',
  navLabel: '请求数据流',
  title: '一次请求，七个阅读步',
  kicker: 'SGLang / 普通生成路径',
  description:
    '按依赖顺序观察文本如何变成 token ID、进入批次与 KV 位置、执行并采样，再由反分词回告。播放与镜头时长只是阅读控制。',
  mode: 'guided' as const,
  instructions:
    '使用步进或播放逐段观察。每一步都保留请求、队列、KV 占用和回程状态，不把连线光点当作运行时证据。',
  lanes: [mainLane],
  scenarios: [
    {
      id: 'request',
      label: '普通请求',
      summary:
        '一条可预测的教学请求路径。每一步只展开本步依赖，不表示真实延迟；同一请求的引用与 KV 数据分开绘制。',
      steps: [
        {
          id: 'arrive',
          label: '到达',
          title: '请求先抵达入口',
          summary:
            '从已送达实例的文本请求开始。HTTP handler 接住请求，但此时还没有 token ID、rid 或调度批次。',
          points: ['网关和负载均衡不在本图范围。'],
          moduleIds: ['api'],
          sourceIds: ['overview.api.0', 'overview.api.1'],
          laneFacts: {
            main: branchFact('入口接收', 'available', '请求还是一个入口侧文本对象。'),
          },
        },
        {
          id: 'tokenize',
          label: '分词与派发',
          title: '形成 rid、token ID 和可调度请求',
          summary:
            'TokenizerManager 把输入组织成 TokenizedGenerateReqInput，携带 rid 与 token ID 派发到调度进程，同时保留前端等待状态。',
          points: [
            'rid 是请求标识，不是 KV 缓存对象。',
            '入口侧与调度进程之间传递的是请求输入，不是设备 KV 值。',
          ],
          moduleIds: ['api', 'tokenizer', 'scheduler'],
          sourceIds: ['overview.tokenizer.0', 'overview.tokenizer.1'],
          laneFacts: {
            main: branchFact(
              '已派发',
              'available',
              '请求引用与 token 序列出现；还没有进入执行批次。',
            ),
          },
        },
        {
          id: 'schedule',
          label: '选批与 KV 位置',
          title: '队列、前缀匹配与可写位置',
          summary:
            'Scheduler 选出本轮批次，准备 ScheduleBatch；RadixCache 匹配可复用前缀，请求到位置的映射与 allocator 给出可写槽位。',
          points: [
            '前缀树只提供索引与管理，不是全部 KV 张量。',
            '物理 KV 值在设备 buffer；这里的色块是占用与位置示意。',
          ],
          moduleIds: ['scheduler', 'cache'],
          sourceIds: [
            'overview.scheduler.0',
            'overview.scheduler.1',
            'overview.cache.0',
            'overview.cache.1',
            'overview.cache.2',
          ],
          laneFacts: {
            main: branchFact(
              '已选批 · 位置就绪',
              'available',
              '请求进入批次；前缀命中与新 token 的槽位被分开标记。',
            ),
          },
        },
        {
          id: 'execute',
          label: '执行与采样',
          title: 'Worker / Runner 执行并采样',
          summary:
            'TpModelWorker 将批次构造成 ForwardBatch，ModelRunner.forward 组织模型与 Attention 后端执行；随后 sample 选择下一 token。',
          points: [
            'Worker、Runner、模型与 attention kernel 在同一调度进程边界内。',
            '计算期间请求仍占用调度与 KV 状态，不是网络光点。',
          ],
          moduleIds: ['execution', 'model', 'cache', 'scheduler'],
          sourceIds: [
            'overview.execution.0',
            'overview.execution.1',
            'overview.execution.2',
            'overview.execution.3',
            'overview.model.0',
            'overview.model.2',
            'overview.cache.2',
          ],
          laneFacts: {
            main: branchFact(
              '执行中',
              'available',
              '计算单元活跃；已分配的 KV 槽位保持占用。',
            ),
          },
        },
        {
          id: 'result',
          label: '结果处理',
          title: '输出 token 写入请求进度',
          summary:
            '结果处理消费本轮批次结果，更新请求进度与结束状态，再发出输出 token ID。未结束的请求继续参与后续调度。',
          points: ['本图只展开一个生成步骤，不声称整段生成已经结束。'],
          moduleIds: ['scheduler', 'execution'],
          sourceIds: [
            'overview.scheduler.0',
            'overview.scheduler.2',
            'overview.scheduler.1',
          ],
          laneFacts: {
            main: branchFact(
              '输出 token 已产生',
              'available',
              '请求仍未完成，继续保留在后续调度状态中。',
            ),
          },
        },
        {
          id: 'detokenize',
          label: '反分词回告',
          title: 'Token ID 变回文本',
          summary:
            'DetokenizerManager 接收 BatchTokenIDOutput，结合每个请求的增量解码状态生成 BatchStrOutput，发回 TokenizerManager。',
          points: ['DetokenizerManager 是独立进程；输入分词在入口侧完成。'],
          moduleIds: ['detokenizer', 'tokenizer', 'api'],
          sourceIds: [
            'overview.detokenizer.0',
            'overview.detokenizer.1',
            'overview.tokenizer.1',
          ],
          laneFacts: {
            main: branchFact('文本回告', 'available', 'token ID 变成回程文本。'),
          },
        },
        {
          id: 'complete',
          label: '完成与释放',
          title: '请求结束，缓存接管可复用 KV',
          summary:
            '请求走到结束状态，释放请求槽位和缓存锁引用。此例启用 RadixCache 且允许插入，可缓存的 KV 由缓存树继续持有；重复部分与不齐页尾按条件回收，不表示全部位置立即空闲。',
          points: [
            '“引用释放”与“物理设备容量消失”不是一回事。',
            '队列占用归零，保留的 KV 色块转为缓存持有状态；图形数量不代表实际容量，不展开后续淘汰。',
          ],
          moduleIds: ['scheduler', 'cache', 'api'],
          sourceIds: [
            'overview.cache.finished',
            'overview.scheduler.2',
            'overview.cache.0',
            'overview.cache.2',
            'overview.api.0',
          ],
          laneFacts: {
            main: branchFact(
              '完成',
              'neutral',
              '请求引用与等待状态释放；可缓存 KV 仍由 RadixCache 持有，物理池保持存在。',
            ),
          },
        },
      ],
    },
  ],
};

export const pdLanes = [legacyLane, modernLane];

export const sceneProvenance = {
  overview: {
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    shortCommit: MAIN_COMMIT.slice(0, 10),
    label: '普通链路固定基线',
    scope:
      '普通 Python 文本生成、单卡合并部署、普通非 overlap 循环；不混入 PD 对比场景。',
    reviewed: '2026-10-29',
  },
  requestFlow: {
    repository: SGLANG_REPOSITORY,
    commit: MAIN_COMMIT,
    shortCommit: MAIN_COMMIT.slice(0, 10),
    label: '普通请求流固定基线',
    scope:
      '仅做依赖顺序的教学展开；不表示运行时毫秒、实际网络拓扑或性能。',
    reviewed: '2026-10-29',
  },
  pdCompare: {
    repository: SGLANG_REPOSITORY,
    commit: `${PD_OLD_COMMIT} / ${PD_NEW_COMMIT}`,
    shortCommit: '94602c9 / e00930c',
    label: 'PD 角色切换双端对比',
    scope:
      '只比较 PD 运行中角色切换的管理 API 与 supervisor 路径；不代表全部版本差异，旧版仍有 PD 与 PDMux。',
    reviewed: '2026-10-29',
  },
};
