import type { SceneDefinition, ViewerPack } from '../../viewer/types';
import { moduleDocs, processGroups } from './modules';
import {
  compareScenarios,
  mechanismSceneData,
  overviewSceneData,
  pdLanes,
  requestFlowSceneData,
  sceneProvenance,
} from './scenarios';
import { createMechanismTrace } from './mechanism';
import { buildMechanismReadout } from './mechanism-readout';
import { REVIEW_DATE, SGLANG_REPOSITORY, allSources } from './sources';
import { createOverviewMapScene, createRequestFlowScene } from './three/map-scene';
import { createPdRoleSwitchScene } from './three/pd-scene';
import { createMechanismScene } from './three/mechanism-scene';

const overviewScene: SceneDefinition = {
  ...overviewSceneData,
  provenance: sceneProvenance.overview,
  buildLane: ({ reducedMotion }) => createOverviewMapScene(reducedMotion),
};

const requestFlowScene: SceneDefinition = {
  ...requestFlowSceneData,
  provenance: sceneProvenance.requestFlow,
  buildLane: ({ reducedMotion }) => createRequestFlowScene(reducedMotion),
};

const mechanismScene: SceneDefinition = {
  ...mechanismSceneData,
  provenance: sceneProvenance.mechanism,
  readout: ({ time, moduleId, options }) =>
    buildMechanismReadout(
      createMechanismTrace({ sharedPrefix: options.prefix !== 'distinct' }),
      time,
      moduleId,
    ),
  buildLane: ({ reducedMotion, options }) =>
    createMechanismScene({
      sharedPrefix: options.prefix !== 'distinct',
      reducedMotion,
    }),
};

const pdCompareScene: SceneDefinition = {
  id: 'pd-compare',
  navLabel: 'PD 角色切换',
  title: '同一个 P，变成 D',
  kicker: 'v0.5.20 / v0.5.21 · 运行时角色切换',
  description:
    '左右两栏按语义里程碑对齐。新版展示管理 API、前置检查、拆旧、重建与重分派；旧版只到“此管理 API 与 supervisor 路径不可用”，仍保留 PD / PDMux 与启动时角色循环。',
  mode: 'compare',
  provenance: sceneProvenance.pdCompare,
  lanes: pdLanes,
  scenarios: compareScenarios,
  instructions:
    '切到“正常切换”看队列与前缀被拆除、物理池保留；“忙时拒绝”看请求与旧结构原地不动；“重建失败”看 unhealthy 与无自动回滚。左右使用各自固定 commit。',
  buildLane: ({ lane, reducedMotion }) =>
    createPdRoleSwitchScene(lane, reducedMotion),
};

export const sglangPack: ViewerPack = {
  id: 'sglang',
  title: 'SGLang 机制地图',
  subtitle: '从普通请求到 PD 运行时角色切换',
  context: 'AI Infra Wiki · 第二章入口',
  summary:
    '以固定 commit 的源码为证据，阅读入口、调度、执行与 KV 边界的协作；再对比 v0.5.20 与 v0.5.21 的 PD 角色切换路径。',
  repository: SGLANG_REPOSITORY,
  reviewDate: REVIEW_DATE,
  modules: moduleDocs,
  groups: processGroups,
  sourceAnchors: allSources,
  scenes: [overviewScene, requestFlowScene, pdCompareScene, mechanismScene],
  notes: [
    '图形状态由可复现场景步骤驱动；镜头移动与播放时长只是阅读控制，不代表真实耗时。',
    '总览使用 main 基线 279339f；PD 对比分别固定 v0.5.20 与 v0.5.21 的 commit，不把两者混用。',
    '旧侧的准确表述是“此管理 API 与 supervisor 路径不可用”，它仍有 PD 与 PDMux。',
    'Decode CUDA graph 前置余量在正常与失败分支中明确假定通过；不模拟 Graph 捕获。',
    '物理 token KV pool 保留，不等于热前缀或 KV 语义在角色间有效。',
  ],
};

export { moduleDocs, processGroups } from './modules';
export { compareScenarios, pdLanes, sceneProvenance } from './scenarios';
export { allSources, sourceFor } from './sources';
export { derivePdVisualState, pdModuleIds } from './three/pd-state';
export type { PdVisualState } from './three/pd-state';
