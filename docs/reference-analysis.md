# 参考源码的复用与补充分析

读取日期：2026-10-29。这里只分析教学软件实现，不复核参考站点的全部模型架构结论。

## 固定来源

- [InfraTech](https://github.com/CalvinXKY/InfraTech/tree/48e358a4b5119c24cf472adc64d0b4f86f894e99/models/3d_model_arch_tool)：commit `48e358a4b5119c24cf472adc64d0b4f86f894e99`。23 个文本文件已读取，线上 app.js 与该提交内容相同。实际操作过总览、模块下钻和来源面板。
- [原始 transformer-architecture](https://github.com/petergpt/transformer-architecture/tree/c4259a6f702e78d64e3fb1d86349530dd1cb78b8)：commit `c4259a6f702e78d64e3fb1d86349530dd1cb78b8`。LICENSE 明确 MIT，Copyright 2026 Peter Gostev。
- InfraTech 的 `camera-path.mjs` 与原始仓库 `dist/camera-path.mjs` 的通用插值部分一致（排除 import URL）。可从许可明确的原始仓库提取该部分，无须推定 InfraTech 所有新增代码具有同样许可。

## 哪些可以直接复用

| 内容 | 源码入口 | 复用方式与边界 |
| --- | --- | --- |
| WebGL 渲染、拾取、几何、材质 | Three.js；参考 app.js 的 WebGLRenderer、Raycaster | 使用固定 npm 依赖，保留 Three.js MIT；不自写底层 3D 引擎 |
| 轨道旋转与缩放 | Three.js addons/controls/OrbitControls | 直接使用官方组件；约束、DOM 标签与生命周期由查看器管理 |
| 相机路径插值 | 原始 `dist/camera-path.mjs::tangent/sampleCameraPath` | MIT 部分可以提取，保留版权；去除 Transformer 专用 cue/节点假设，补类型与非法输入检查 |
| 导览时钟基本方法 | 原始 `dist/story.mjs::StoryClock` | play/pause/seek 可复用；它只控制阅读时间，不能用来推导请求准入和资源释放 |
| 原始 GLB/模型素材 | 原始仓有 MIT 说明及资产归属 | 技术上可按各自许可复用，但其 Transformer 层与 SGLang 软件模块含义不同，本项目不需要搬入 |

“可复用”是技术评估，不表示本项目已经使用表中全部代码。实际导入与改编以 THIRD_PARTY_NOTICES、LICENSES 和代码头部记录为准。

## 哪些需要改造

| 参考方式 | SGLang 机制查看器需要的改造 |
| --- | --- |
| `models/catalog.js` 的 facts/roles/beats/sources | 改为内容包：场景、稳定模块 ID、版本、状态、条件和源码锚点；引擎不硬编码模型层数 |
| `componentFor()` 按 part/branch 找同类，必要时退回首个同类 | 显式映射同一语义模块；拆分、合并、缺失、未核对应分别标记，不能把相邻盒子当同一机制 |
| 双视口的相机同步 | 可共享阅读视角；状态对齐依赖语义里程碑，不是相同秒数或相同帧号 |
| `spatial-build.js` 根据 nodes/edges/frames 程序化建模 | 场景需表达进程、设备、请求引用、队列与 KV 数据；盒子位置不自动表示真实物理部署 |
| `story.mjs` 的固定章节与通用解说 | 由可复现状态序列提供步骤；每步要显示动作、条件和结果，播放只对状态过渡插值 |
| `tickInterior()` 内部矩阵/专家等模型示意 | 换成 SGLang 的队列成员、请求映射、缓存占用和完成门槛；每种机制采用能解释它的图形 |

## 必须补充的能力

1. **可复现的机制状态**：同一场景可以步进、回退、暂停和重置；改变条件回到起点。流动对象携带明确身份、载荷和方向。
2. **两端源码证据**：版本标签、完整 commit、文件、行号和验证范围；未核对的内容不冒充差异。`tools/verify_source_evidence.py` 可复查固定文件字节和关键锚点。
3. **真实差异分支**：首例 PD 角色切换包括忙时拒绝、成功拆建、重建失败 unhealthy；保留物理 KV pool 不等于保留热前缀。
4. **嵌入生命周期**：可挂载到任意容器、销毁、再次挂载；释放 WebGL、事件、观察器和动画请求，离屏/隐藏时不空转。
5. **降级与阅读路径**：键盘、窄屏、减少动态效果、无 WebGL 和无 JS 内容；模块下钻仍可返回固定源码。
6. **发布与维护**：引擎/内容包分离、固定依赖、可重复构建、状态测试和浏览器验收。Wiki 可以固定一个发布 tag，升级时显式更换，避免同名可变资源被旧缓存混用。

## 对第二章的适用性

适合在第二章开始提供可操作的 3D 总览，并下钻数据流、模块状态及版本变化。现有课程承担深入阅读；同一事实和源码基线应共享内容数据，避免维护互相矛盾的两套解释。首版只覆盖已核对的普通请求基线及 PD 角色切换差异，不宣称已经比较所有 SGLang 版本或十二模块的全部内部实现。
