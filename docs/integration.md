# 接入静态站点与第二章

## 第二章入口

在第二章正文开头放置一个容器，使用本仓构建产物挂载 SGLang 内容包。默认场景是系统总览，读者可以选择普通请求流与 PD 版本对比，再点选模块查看职责、对象、边界和固定源码。原课程仍负责详细讲解，不应把 3D 场景当成课程全部内容或线上执行轨迹。

建议固定 `v0.2.0` 的完整构建目录并从本站提供。调用站点保留自己的发布流程；本仓提供代码和证据，不自动发布调用站点。可先使用 `npm run build`、本地 HTTP 服务器和 `examples/embed.html` 检查挂载。

## API

```ts
import { mountSglangViewer } from './embed/sglang-viewer.js';

const viewer = mountSglangViewer(container, {
  initialSceneId: 'overview', // request-flow / mechanism / pd-compare
  initialLaneMode: 'both',   // left / right
  syncHash: false,           // 独立页面可 true；多个实例应 false
  onEvent(event) { console.info(event.type); }
});

viewer.setScene('pd-compare');
viewer.setScenario('busy'); // normal / busy / failed
viewer.setStep(2);          // zero-based，自动约束到有效范围
viewer.selectModule('pd.pool');
viewer.resetCamera();
viewer.getState();
viewer.play();
viewer.pause();
viewer.seek(4.2); // 阅读时间，单位秒；定位会暂停，不代表真实推理耗时
viewer.setSpeed(0.5);
viewer.getPlayback(); // time / duration / speed / playing / stepIndex / progress
viewer.setScene('mechanism');
viewer.setOption('prefix', 'distinct'); // shared / distinct；修改条件从起点开始
const unsubscribe = viewer.subscribe(() => { /* 读取界面状态或播放位置 */ });
unsubscribe();
viewer.destroy();
```

`setScene`、`setScenario` 和 `setLaneMode` 都回到第一个步骤并暂停；主动步进和模块点选会暂停播放。选中模块后再播放、步进或拖动时间线，会保留模块详情与阅读视角。`destroy()` 可重复调用，释放动画、事件、观察器、WebGL 与 DOM；容器本身保留，可再次挂载。不要在销毁后继续操纵同一实例。

开启 `syncHash` 后，独立页面链接可恢复场景、分支、步骤、版本侧和模块，例如：

```text
#scene=pd-compare&case=failed&step=4&node=pd.health
```

路径里的 `step` 是阅读步骤，不能被解释成真实毫秒。未知参数回退到合法默认值。所有来源均固定 commit，旧版缺少某条管理路径时不会构造虚假执行轨迹。

## 自定义内容包

```ts
import { mountViewer } from './embed/infra-mechanism-viewer.js';
const viewer = mountViewer(container, { pack: myPack, syncHash: false });
```

`ViewerPack` 接口见 `src/viewer/types.ts`，包含模块、来源、场景、版本侧、情景分支、语义步骤与场景工厂。每个 `buildLane()` 返回独立的 Three.js 场景、节点标签、焦点与生命周期回调。

通用引擎管理视角、操作与挂载；内容包负责机制事实、场景对象和状态转换。比较使用稳定语义模块 ID。不能用屏幕中相邻位置、时间进度相同或同名函数自动推导版本等价。缺少的模块、被拆分的模块和未复核的内容应明确处理。无需导入 SGLang 内容包即可开发另一个 Infra 系统的内容包。

## 嵌入边界

- 样式位于 Shadow DOM，宿主页字体、按钮与选择器不会被全局覆盖。给宿主容器留出足够宽度，窄屏采用分段阅读。
- 左右比较同步轨道旋转和缩放；节点点选按同一语义 ID 聚焦。不存在的模块不会在旧侧虚构一个同名实现。
- 键盘快捷键只在查看器内拥有焦点时生效：方向键步进、空格播放、R 重置步骤、C 重置镜头。表单与按钮保留原生行为。
- 无 WebGL 时使用文本步骤、条件和模块档案；独立演示页提供无 JS 概述。嵌入站点应保留自身的静态章节内容，不能只依赖脚本。
- WebGL 是浏览器能力；低资源设备可使用单侧查看。页面隐藏或查看器离屏时停止渲染与播放；恢复可继续手动操作。
- `fallbackOnNoWebGL` 保留为展示选项；无论其值如何，核心文字资料仍可阅读。查看器不会接入真实推理服务、执行任意代码或采集用户请求。

## 版本升级

1. 在本仓更改代码/内容与对应证据，运行受影响检查与实际浏览器验收。
2. 发布固定 Git tag，调用站点构建或取该 tag 的产物。
3. 将完整 `dist/embed/` 和 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`LICENSES/` 一起放入站点的新版本目录。
4. 修改调用站点的 import 路径，验收第二章首屏、深链接和已有课程，再按调用站点流程发布。

源码事实变化与视觉优化分开记录。变更基线时同时更新 commit、来源锚点、状态语义与 `docs/source-manifest.json`，不能只替换版本标签。

## 连续回放与框架边界

界面使用 React，Three.js 实例由独立渲染层管理；宿主站点只调用挂载 API，无需整体迁移到 React，也无需提供 Node 的 `process` 全局。嵌入构建包含生产 React 运行时与第三方许可。

`setStep` / `seekStep` 定位到对应事件的开始，`seek` 定位任意中间位置；它们都会暂停。事件内部的确定状态保持在动作完成之前，完成后才发布结果。暂停冻结自动回放，镜头拖拽仍用于阅读。场景与条件变化从起点开始；模块详情选择保留当前时间。

`PlaybackClock` 与 `sampleTimeline` 从通用 ES module 入口导出，不依赖 React 或 Three.js。自定义内容包通过 `SceneHandle.setPlayback` 接收统一的时间、事件进度与状态，不应另起一个与查看器无关的计时器。旧的 `setStep` 接口保留给静态或兼容内容包。

构建目录内 `manifest.json` 记录版本、Git 提交、构建时工作区状态，以及每个分发文件的 SHA-256。正式接入应采用干净提交生成的完整目录，核对清单后再替换调用站点的固定版本路径。该清单不代表已经发布到 npm 或托管了在线演示。
