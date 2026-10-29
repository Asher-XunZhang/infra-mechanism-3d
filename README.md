# infra-mechanism-3d

可嵌入静态学习站点的交互式 3D 机制查看器。SGLang 是首个内容包：从模块边界、请求流到固定版本的机制差异，让读者点选模块、逐步观察资源变化，并返回对应源码。

## 本版能看什么

- **系统总览**：7 个模块，区分入口、调度、反分词进程与 GPU 设备边界。
- **请求数据流**：7 个阅读步骤；观察请求、队列、执行和 KV 占用。完成时释放请求引用，可缓存 KV 仍由 RadixCache 持有。
- **PD 角色切换**：左右比较 v0.5.20 / v0.5.21 的管理 API 与 supervisor 路径；正常切换、忙时拒绝、重建失败三种分支，独立源码锚点与同步视角。

支持旋转、缩放、模块下钻、键盘选择、播放/暂停、前进/回退、重置、深链接、减少动态效果、无 WebGL 文本阅读。内容状态是源码支持的教学模型；播放秒数、色块数量和空间位置不代表实测性能、内存容量或物理部署。旧版仍有 PD/PDMux，“不可用”仅指被比较的运行时管理路径。

## 运行

需要 Node.js 22.12+ 与 npm。依赖固定在 `package-lock.json`。

```bash
npm ci
npm run dev
```

打开终端给出的本地地址。检查与构建：

```bash
npm test
npm run build
npm run preview
python3 -B -m unittest discover -s tools -p 'test_*.py'
```

`dist/` 是静态演示站；`dist/embed/` 是可嵌入的 ES module 包。构建不会发布网站或 npm 包。不要双击 HTML 使用 `file://`，应通过 HTTP 访问。

## 嵌入与维护

将 `dist/embed/` **整个目录**放入站点的版本目录，例如 `vendor/infra-mechanism-3d/v0.1.0/`，不要只复制入口 JS，它会引用同目录的构建 chunk。

```html
<div id="sglang-mechanism"></div>
<script type="module">
  import { mountSglangViewer } from './vendor/infra-mechanism-3d/v0.1.0/sglang-viewer.js';
  const viewer = mountSglangViewer(document.querySelector('#sglang-mechanism'));
  // 路由卸载时调用 viewer.destroy()，之后可以重新挂载。
</script>
```

CSS 隔离在 Shadow DOM 中；嵌入默认不占用宿主页 URL hash。独立页面可设 `syncHash: true`。具体 API、第二章接入方式、多实例和升级约定见 [接入说明](docs/integration.md)；完整静态示例见 [examples/embed.html](examples/embed.html)。

源码在本仓修复，测试并构建后由调用站点显式更新固定版本目录。不要依赖可变的 `main` URL 热替换生产资源。该项目不自动修改或部署 AI Infra Wiki。

## 证据和复用

| 场景 | 源码基线 |
| --- | --- |
| 总览 / 普通请求 | `sgl-project/sglang` main 固定提交 `279339f113b79af84f27fd3ac92d0a13bd3f4cbd` |
| PD 旧侧 | v0.5.20 · `94602c9c2b7cbdb8efd5c52802dac6a1c180089e` |
| PD 新侧 | v0.5.21 · `e00930c5489053f26d86b179cee0d087f846acbb` |

读取日期 2026-10-29；固定 Git 对象/公开文件只读核对，未修改外部源码，未运行 GPU 推理或性能测试。这三条基线不能混称同一版本。首版不覆盖所有 SGLang 机制或版本变化。

- [参考站点的源码复用、改造与补充分析](docs/reference-analysis.md)
- [SGLang 源码事实与教学边界](docs/source-review.md)
- [证据文件清单](docs/source-manifest.json)

复查证据文件的 SHA-256、锚点与关键符号：

```bash
python3 -B tools/verify_source_evidence.py --fetch --cache .cache/source
# 已有源码 Git 对象时，也可通过 --checkout <source-checkout> 只读校验。
```

无法读取文件会失败，不能作为“旧版不存在该功能”的证据。普通请求完成与 PD 切换的缓存行为分别有源码依据。

## 代码组织

- `src/viewer/`：通用状态、查看器、相机与渲染生命周期。
- `src/content/sglang/`：独立内容包、版本证据、场景与状态语义。
- `src/lib/`：通用与 SGLang 专用嵌入入口。
- `docs/`、`tools/`：证据、复用分析和可重复的源码校验。

本仓代码采用 MIT。通用相机插值改编自 Peter Gostev 的 MIT 项目；Three.js 与 OrbitControls 使用其 MIT 许可。未复制 InfraTech 的整套 app.js、GLB 或模型讲稿。详细归属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
