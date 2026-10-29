# infra-mechanism-3d

面向用户使用简体中文。维护通用 3D 机制查看器；SGLang 是首个内容包。先读 README 与 docs 的证据范围，图形状态必须由可复现场景数据驱动。不要把空间位置、动画秒数当作物理部署或实测时间。每个版本独立固定 commit；缺少证据的差异不得展示为已确认。

本项目由 Codex 与 DeepSeek Harness 协同实现。Harness 使用 DeepSeek-V4.1-Flash-1017、Max，主导视觉与交互；Codex 可直接参与源码、状态机、证据校验与验收发布。每批先明确文件所有权，避免并发修改同一文件。不要递归委派。不要修改外部 Wiki 或 SGLang 源码仓。

浏览器检查使用独立无头会话，记录主 PID、profile 与辅助进程；try/finally 关闭并核对退出，不得操作用户原有浏览器。跑与改动相称的模型和浏览器检查。不要将本机绝对路径、调试日志、缓存、node_modules、凭据或截图临时文件提交。
