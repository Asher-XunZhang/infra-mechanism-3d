# Third-party notices

## Three.js

Three.js 0.186.1, including OrbitControls and RoundedBoxGeometry, is used under the MIT License. Copyright © 2010–2026 three.js authors. See [LICENSES/Three-MIT.txt](LICENSES/Three-MIT.txt) for the distributed permission notice and [the project](https://github.com/mrdoob/three.js).

## Camera interpolation

`src/viewer/three/camera-path.ts` adapts the shape-preserving Hermite interpolation in Peter Gostev's [transformer-architecture/dist/camera-path.mjs](https://github.com/petergpt/transformer-architecture/blob/c4259a6f702e78d64e3fb1d86349530dd1cb78b8/dist/camera-path.mjs), pinned to commit `c4259a6f702e78d64e3fb1d86349530dd1cb78b8`.

Copyright (c) 2026 Peter Gostev. MIT License. Full notice: [LICENSES/PeterGostev-MIT.txt](LICENSES/PeterGostev-MIT.txt). Changes include TypeScript interfaces, input validation, and separation from model-specific camera cues and implicit framing. No original GLB assets or model scripts are distributed.

## Design reference and evidence

[CalvinXKY/InfraTech](https://github.com/CalvinXKY/InfraTech/tree/48e358a4b5119c24cf472adc64d0b4f86f894e99/models/3d_model_arch_tool) inspired comparative exploration and component drill-down. Its application and model assets are not copied. See [the source reuse analysis](docs/reference-analysis.md).

[SGLang](https://github.com/sgl-project/sglang) source is referenced using fixed public commits and short symbol anchors. The content pack is an independently authored teaching representation, not a bundled SGLang runtime. Source URLs and the verification scope are documented in `docs/`.

When distributing a built viewer, include this notice, the project LICENSE, and the LICENSES directory alongside the JavaScript files.
