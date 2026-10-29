export type PdLaneVersion = 'v0520' | 'v0521';
export type PdNewStructure = 'none' | 'ready' | 'broken';
export type PdGate = 'idle' | 'pass' | 'reject';
export type PdApi = 'idle' | 'active' | 'blocked';
export type PdSupervisor = 'hidden' | 'active' | 'fixed';
export type PdHealth = 'ok' | 'busy' | 'unhealthy' | 'blocked';

/**
 * Pure visual state for the PD role-switch comparison.
 *
 * This is deliberately separate from Three.js so the branch semantics can be
 * tested without a canvas. Every value is derived from the reviewed scenario
 * steps; the renderer never invents a teardown, rollback or new role on its own.
 */
export interface PdVisualState {
  version: PdLaneVersion;
  phase: string;
  status: string;
  detail: string;
  api: PdApi;
  gate: PdGate;
  graphGate: 'assumed' | 'skipped';
  oldStructure: 'present' | 'removed';
  oldQueueOccupied: number;
  requestCount: number;
  prefix: 'present' | 'reset';
  poolVisible: true;
  poolOccupied: number;
  newStructure: PdNewStructure;
  supervisor: PdSupervisor;
  health: PdHealth;
  autoRollback: false;
}

function legacyState(scenarioId: string): PdVisualState {
  const busy = scenarioId === 'busy';
  return {
    version: 'v0520',
    phase: busy ? 'legacy-busy' : 'legacy-fixed',
    status: '此管理 API 与 supervisor 路径不可用',
    detail:
      '旧版仍保留 PD/PDMux 与启动时角色循环；固定文件中没有 /pd_role_switch 与 run_event_loop_supervisor。',
    api: 'blocked',
    gate: 'idle',
    graphGate: 'skipped',
    oldStructure: 'present',
    oldQueueOccupied: busy ? 3 : 0,
    requestCount: busy ? 3 : 0,
    prefix: 'present',
    poolVisible: true,
    poolOccupied: busy ? 8 : 0,
    newStructure: 'none',
    supervisor: 'fixed',
    health: 'blocked',
    autoRollback: false,
  };
}

function baseState(version: PdLaneVersion): PdVisualState {
  return {
    version,
    phase: 'drain',
    status: '外部排空 · 等待管理请求',
    detail: '外部编排先摘流并排空；管理 API 之后仍会再做空闲检查。',
    api: 'idle',
    gate: 'idle',
    graphGate: 'skipped',
    oldStructure: 'present',
    oldQueueOccupied: 0,
    requestCount: 0,
    prefix: 'present',
    poolVisible: true,
    poolOccupied: 0,
    newStructure: 'none',
    supervisor: 'hidden',
    health: 'ok',
    autoRollback: false,
  };
}

export function derivePdVisualState(
  scenarioId: string,
  stepId: string,
  laneId: string,
): PdVisualState {
  if (laneId !== 'v0521') {
    return legacyState(scenarioId);
  }

  const state = baseState('v0521');

  if (scenarioId === 'normal') {
    switch (stepId) {
      case 'drain':
        return state;
      case 'invoke':
        return {
          ...state,
          phase: 'invoke',
          status: '管理请求已到达',
          detail: 'POST /pd_role_switch 交给 TokenizerManager，再进入 Scheduler 控制分发。',
          api: 'active',
        };
      case 'guard':
        return {
          ...state,
          phase: 'guard',
          status: '门槛通过 · 准备拆旧',
          detail: '空闲检查通过；Decode Graph 前置余量按明确假设通过，捕获不展开。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
        };
      case 'teardown':
        return {
          ...state,
          phase: 'teardown',
          status: '旧结构已拆除 · 物理池保留',
          detail: '角色队列、传输管理、元数据与前缀索引释放；物理 token KV pool 不重分配。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
          oldStructure: 'removed',
          prefix: 'reset',
        };
      case 'rebuild':
        return {
          ...state,
          phase: 'rebuild',
          status: 'Decode 结构已建立',
          detail: 'role flip 后初始化新角色结构并同步子组件；前缀不会热保留。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
          oldStructure: 'removed',
          prefix: 'reset',
          newStructure: 'ready',
        };
      case 'supervise':
        return {
          ...state,
          phase: 'supervise',
          status: 'Decode 循环 · 已重新服务',
          detail: '旧循环以重启信号退出，supervisor 在同一进程内重分派到 Decode 循环。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
          oldStructure: 'removed',
          prefix: 'reset',
          newStructure: 'ready',
          supervisor: 'active',
        };
      default:
        return state;
    }
  }

  if (scenarioId === 'busy') {
    const occupied: PdVisualState = {
      ...state,
      phase: 'busy',
      status: '在途请求占用 · 不满足空闲',
      detail: '请求、队列与 KV 位置仍被占用；外部尚未完成排空。',
      oldQueueOccupied: 3,
      requestCount: 3,
      poolOccupied: 8,
      health: 'busy',
    };
    if (stepId === 'busy') {
      return occupied;
    }
    if (stepId === 'invoke-busy') {
      return {
        ...occupied,
        phase: 'invoke-busy',
        status: '管理请求已到达 · 仍未空闲',
        api: 'active',
      };
    }
    if (stepId === 'rejected') {
      return {
        ...occupied,
        phase: 'rejected',
        status: '拒绝：不空闲 · 结构原地保留',
        detail:
          'is_fully_idle() 失败发生在 teardown 之前；没有拆旧、翻转或新结构，物理池也未被重分配。',
        api: 'active',
        gate: 'reject',
        health: 'busy',
      };
    }
    return occupied;
  }

  if (scenarioId === 'failed') {
    switch (stepId) {
      case 'drained':
        return state;
      case 'invoke-failure':
        return {
          ...state,
          phase: 'invoke-failure',
          status: '管理请求已到达',
          detail: '失败分支的入口与正常分支相同；差异从拆建阶段开始。',
          api: 'active',
        };
      case 'guards-pass':
        return {
          ...state,
          phase: 'guards-pass',
          status: '门槛通过 · 失败尚未发生',
          detail: '实例健康且空闲；Graph 前置余量按假设通过。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
        };
      case 'teardown-ok':
        return {
          ...state,
          phase: 'teardown-ok',
          status: '旧结构拆除完成 · 新结构未就绪',
          detail: '旧队列、前缀索引与映射已释放；物理池仍在。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
          oldStructure: 'removed',
          prefix: 'reset',
        };
      case 'rebuild-failed':
        return {
          ...state,
          phase: 'rebuild-failed',
          status: '重建失败 · unhealthy · 需重启',
          detail:
            '旧结构已拆、新结构未建立；没有自动回滚。后续切换会被健康检查拒绝，物理池仍保留。',
          api: 'active',
          gate: 'pass',
          graphGate: 'assumed',
          oldStructure: 'removed',
          prefix: 'reset',
          newStructure: 'broken',
          health: 'unhealthy',
        };
      default:
        return state;
    }
  }

  return state;
}

export const pdModuleIds = [
  'pd.http',
  'pd.scheduler',
  'pd.guard',
  'pd.idle',
  'pd.graph',
  'pd.teardown',
  'pd.prefix',
  'pd.pool',
  'pd.rebuild',
  'pd.supervisor',
  'pd.health',
  'pd.legacy_loop',
] as const;
