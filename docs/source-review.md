# 参考实现与首批证据

读取日期：2026-10-29。只读静态源码核对，未运行 SGLang、GPU、RDMA 或性能实验。

## 参考实现

[InfraTech 架构工具](https://calvinxky.github.io/InfraTech/3d_models/) 的源码位于 [models/3d_model_arch_tool](https://github.com/CalvinXKY/InfraTech/tree/48e358a4b5119c24cf472adc64d0b4f86f894e99/models/3d_model_arch_tool)，固定 main commit `48e358a4b5119c24cf472adc64d0b4f86f894e99`。

可借鉴语义注册表、左右相机同步、模块下钻和导览 cue 的分层；它的 `flow()` 按时间在路径上循环粒子，不是运行时状态机；`roles` 为人工对照，并非源码自动差异分析。本项目独立实现运行时机制接口，不复制其 app.js、GLB、布局资产或模型讲稿。Three.js 依赖使用自身 MIT 许可并保留归属。后续已定位原始 MIT 项目，并提取其通用相机插值部分，来源与取舍见 [参考源码复用分析](reference-analysis.md)。参考仓 README 声明其部分参考代码来源于 Peter Gostev 的 MIT 项目，但未在所读目录发现覆盖整个应用的独立 LICENSE，因此这里不据此转授权整个参考实现。

## 普通请求系统地图

`sglang-overview-evidence.json` 沿用 AI Infra Wiki 中已经核对的公开基线 `279339f113b79af84f27fd3ac92d0a13bd3f4cbd`；本次再次逐项核对其固定 Git 对象。进程/资源边界：HTTP 与 TokenizerManager 位于入口侧；Scheduler、KV 管理、TpModelWorker 与 ModelRunner 在调度进程内协作；Detokenizer 是独立进程；GPU 是设备资源，不是另一服务进程。这里的模块关系不能平铺成严格串行流程，KV 管理与执行存在协作依赖。

最低教学请求可按“输入进入 → token ID 与 rid 派发 → 选批与 KV 位置准备 → Worker/Runner 执行 → 结果处理 → 反分词回告 → 请求完成/引用释放”组织。序列仅解释依赖，不代表真实毫秒；同一请求的引用与 KV 数据不得混为网络载荷。源码锚点见 JSON。此地图基线与下面的版本对比独立，界面应显示所选场景自己的版本。

## 已核对的版本差异：PD 运行中角色切换

- v0.5.20：`94602c9c2b7cbdb8efd5c52802dac6a1c180089e`
- v0.5.21：`e00930c5489053f26d86b179cee0d087f846acbb`

本次完整读取两端 `scheduler.py`、`http_server.py` 和新版 `disaggregation/role_switch.py`。旧版公开固定路径 `role_switch.py` 返回 404，且完整 `http_server.py` 中没有 `/pd_role_switch`，完整 `scheduler.py` 中没有 `PdRoleSwitchReqInput` 或 `run_event_loop_supervisor`。旧版仍有 PD 与 PDMux，不能把本例简化为“旧版完全不支持角色/混部”。准确对比是此管理 API 和对应 supervisor 路径的有无。

旧端锚点：[dispatch_event_loop L5692](https://github.com/sgl-project/sglang/blob/94602c9c2b7cbdb8efd5c52802dac6a1c180089e/python/sglang/srt/managers/scheduler.py#L5692)，L5695–5719 根据当时角色直接选择对应普通/overlap/PP 循环。旧端 [http_server.py](https://github.com/sgl-project/sglang/blob/94602c9c2b7cbdb8efd5c52802dac6a1c180089e/python/sglang/srt/entrypoints/http_server.py) 没有此端点；将旧侧显示为“此 API 路径不可用”，不要动画演出虚构 404 网络请求或重启耗时。

新端锚点均使用 v0.5.21 commit：

| 行为 | 路径与行号 | 可见教学状态 |
| --- | --- | --- |
| 管理入口 | `entrypoints/http_server.py` L1577–1592 | POST /pd_role_switch 交给 TokenizerManager |
| 接收/分发控制请求 | `managers/scheduler.py` L1793、L5832 | Scheduler 处理切换请求 |
| 检查门槛 | `disaggregation/role_switch.py::_reject_reason` L159–215 | 开关、健康、重入、目标角色、PD 模式、后端能力和 staging 条件 |
| 检查空闲 | `handle_pd_role_switch` L73–77 | 有在途请求时拒绝，旧角色和资源不拆除；排空由外部编排完成 |
| Graph 余量 | 同文件 L79–111 | 切 Decode 且没有 graph 时需声明所需内存并检查余量；未通过不 teardown |
| 拆除和重建 | 同文件 L113–135、L229–253 | 拆除旧角色队列/传输管理/元数据；翻转 role，初始化新角色并同步子组件 |
| 保留物理池、释放缓存占用 | 文件头 L1–5；L256–284 | 物理 token KV pool 不重分配；缓存树 reset、请求映射和 allocator clear，不能宣称热前缀保留 |
| 拆除/重建失败 | L124–135 | unhealthy，需要重启，无就地回滚 |
| 延后 Graph 捕获失败 | L137–144 | 记录异常并退为 eager，不等同拆除失败 |
| 重新选择循环 | L146–150；L29–40；scheduler.py L5934 | restart 标记 → supervisor 重新分派到新角色循环 |

首个对比场景可用“一台 P 想转 D”分别呈现：正常排空后切换；忙时拒绝；拆除/重建失败。若未完整实现 Graph 余量模型，应在条件说明写清本例假定检查通过且不展开 Graph 捕获，不得跳过门槛还称完整模拟。状态图可以省略与所选路径无关的分支，但不能把外部摘流画成 API 内自动执行。

版本事实与教学步骤分离：每个比较事件记录 before/after、受影响模块、触发条件、证据 URL、说明；未被核对的全版本差异不作展示。左右对齐按语义里程碑（请求切换、前置检查、拆旧、建新、重新服务），不能假设相同帧号等于相同真实时间。

## 普通请求完成后的缓存所有权

普通请求完成不等于所有 KV 槽位立即空闲。固定基线 `279339f` 的 [`RadixCache.cache_finished_req`](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/mem_cache/radix_cache.py#L479-L560) 在缓存启用且允许插入时，把可缓存索引插入树并由 RadixCache 持有内存池引用；仅重复区间、未插入部分和不齐页尾等按条件释放。请求结束会释放请求槽位、降低缓存锁引用，不能把“请求不再占用”画成“缓存内容全部消失”。普通请求示例选择可缓存前缀仍在、请求占用归零的结果，不展开后续淘汰策略。该行为和 PD 角色切换的前缀 reset 属于不同场景。
