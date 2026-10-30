# 连续机制回放与 SGLang 教学模型

本模型用于解释同一请求怎样经过调度、执行、前缀复用和资源释放。它不是 GPU 执行器，也不是延迟或吞吐预测器。

## 阅读基线

| 项目 | 内容 |
| --- | --- |
| 源码仓库 | https://github.com/sgl-project/sglang |
| 基线 | 公开 main 的固定提交 `279339f113b79af84f27fd3ac92d0a13bd3f4cbd` |
| 读取时间 | 2026-10-30 |
| 工作区 | 原源码检出存在本地变更；只读取指定 Git 对象及已校验的固定文件，不采用工作区变更 |
| 操作范围 | 源码复核、教学模型测试与浏览器展示；未运行 GPU 推理或性能实验 |

## 从输入到可回放状态

`src/core/timeline.ts` 只管理阅读时间，不依赖 DOM、React 或 Three.js。时间线可以播放、暂停、定位、改变速度；订阅者读取稳定快照。渲染器不会决定机制是否已经完成。

`src/content/sglang/mechanism.ts` 生成连续事件。每个事件包含固定的 `before` / `after`、输入输出载荷、参与模块、请求身份和来源锚点。`sampleMechanism(trace, time)` 总能从时间重建相同状态：过渡尚未结束时，确定的语义状态保持为 `before`；到达事件边界才提交 `after`。移动中的载荷和目标位置可以显示为进行中，但不能作为已完成数据。

这使“暂停在前缀查找一半”与“回看同一位置”具有一致含义。动画时长仅为阅读安排，不能用于比较两个 SGLang 版本的速度。PD 比较仍采用自身独立版本基线，不与本模型混称同一版本。

## 示例与简化

模型使用普通自回归生成、全注意力、相同模型和缓存命名空间、`page_size=1`、12 个示意 KV 位置。关闭 overlap、chunk、投机生成、分离部署；不触发缓存淘汰。每请求输出 3 个示例 token。R2 在 R1 完成后进入，因此本例不模拟两个请求的并发调度。

- R1 输入 `[11,12,13,14]`，依次生成 `[101,102,103]`。
- 共享情景：R2 输入 `[11,12,21,22]`，复用两个已有位置。
- 不共享情景：R2 输入 `[31,32,21,22]`，没有命中。
- R2 两种情景均生成占位输出 `[201,202,203]`。这些数字不代表真实语言模型结果。

前缀比较按 token 展开；真实 RadixCache 会压缩、拆分节点，并维护分层锁引用。本图记录逻辑缓存路径和请求对物理位置的引用，不声称图上的计数等于某个树节点的 `lock_ref`。

## 读者应能看见的因果关系

| 事件 | 条件与动作 | 完成后可观察的变化 |
| --- | --- | --- |
| 入口与排队 | 文字经分词形成带 rid 的输入，交给 Scheduler | 同一请求出现在等待队列；KV 没有作为入口消息传输 |
| 前缀匹配 | 同命名空间内比较输入前缀 | 返回命中位置；命中不复制物理 KV |
| 选批与分配 | 选中的请求需要可写位置 | 等待引用移入运行/批引用；新位置已分配但尚未写入 |
| Prefill | 读取命中历史，为未命中输入执行 forward | 新输入的 K/V 写入；随后结果处理追加第一个输出 token |
| 未完成缓存 | Prefill 结果处理允许插入已计算前缀 | 缓存持有与请求引用同时存在，不能画成二选一的所有权 |
| Decode | 上一个输出 token 作为下一轮输入 | 每轮增加一个位置、写入该输入的 K/V，再返回一个新输出 |
| 完成 | 达到示例输出长度，缓存已计算范围 | 请求槽位和引用释放，可缓存 KV 保留；最终采样 token 没有再执行 forward，因而没有它的 KV |

R1 完成时保存 6 个物理位置：4 个输入位置，加上 101 和 102 的位置。R2 共享情景只增加 4 个位置，不共享情景增加 6 个位置，最终分别占用 10 / 12 个示意位置。它们解释复用效果，不构成性能基准。物理池容量始终为 12；占用数变化不表示重新创建物理池。

## 固定源码锚点

以下链接全部固定到上述提交。

| 行为 | 源码 |
| --- | --- |
| 接收、选批、运行、处理结果并再次循环 | [scheduler.py:1907](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/managers/scheduler.py#L1907) |
| Extend 只准备未命中部分，并分配位置 | [schedule_batch.py:2678](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/managers/schedule_batch.py#L2678) |
| Decode 输入关系与逐请求新增位置 | [schedule_batch.py:3470](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/managers/schedule_batch.py#L3470) |
| Prefill 结果追加 token；未完成前缀缓存 | [batch_result_processor.py:358](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/managers/scheduler_components/batch_result_processor.py#L358) |
| Decode 结果处理入口 | [batch_result_processor.py:920](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/managers/scheduler_components/batch_result_processor.py#L920) |
| 最长前缀返回设备位置索引，可拆分压缩节点 | [radix_cache.py:397](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/mem_cache/radix_cache.py#L397) |
| 完成时插入缓存、释放重复区间与锁引用 | [radix_cache.py:479](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/mem_cache/radix_cache.py#L479) |
| 未完成请求的缓存与引用调整 | [radix_cache.py:561](https://github.com/sgl-project/sglang/blob/279339f113b79af84f27fd3ac92d0a13bd3f4cbd/python/sglang/srt/mem_cache/radix_cache.py#L561) |

## 验收不变量

同一请求身份不变；队列、批、缓存锁与物理数据具有不同生命周期。共享前缀指向同一物理位置。所有请求位置都有有效引用；所有缓存位置已写入。新采样 token 不会提前拥有 K/V。完成后请求映射为空，保留的缓存不消失。暂停不能推进模型或几何；任意回看不能依赖之前播放过哪些步骤。UI、几何和来源必须共同使用这一份事件模型。
