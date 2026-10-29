import * as THREE from 'three';
import { requestResources } from './request-state';
import type {
  FocusPoint,
  OverlayLabelSpec,
  SceneHandle,
  StepRenderContext,
} from '../../../viewer/types';
import {
  MotionRunner,
  addEdges,
  cellGrid,
  colorFor,
  glowSprite,
  lineAlong,
  markNode,
  palette,
  roundedBox,
  setCellActive,
  standardMaterial,
  tubeAlong,
} from '../../../viewer/three/toolkit';

type MapMode = 'atlas' | 'flow';
type NodeId =
  | 'api'
  | 'tokenizer'
  | 'scheduler'
  | 'execution'
  | 'cache'
  | 'model'
  | 'detokenizer';

interface NodeLayout {
  id: NodeId;
  position: THREE.Vector3;
  width: number;
  height: number;
  depth: number;
  accent: string;
  meta: string;
}

interface NodeVisual {
  id: NodeId;
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Sprite;
  edgeMaterial: THREE.LineBasicMaterial;
  accent: number;
  focus: FocusPoint;
  queueSlots?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  kvCells?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  computeCells?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  tokenTiles?: THREE.Object3D;
  prefixNodes?: Array<{
    node: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
    depth: number;
  }>;
}

const nodeLayouts: NodeLayout[] = [
  {
    id: 'api',
    position: new THREE.Vector3(-7.05, 0, -0.25),
    width: 1.55,
    height: 1.0,
    depth: 1.3,
    accent: 'cyan',
    meta: 'HTTP / OpenAI',
  },
  {
    id: 'tokenizer',
    position: new THREE.Vector3(-5.45, 0, 1.65),
    width: 1.85,
    height: 0.9,
    depth: 1.35,
    accent: 'cyan',
    meta: 'TokenizerManager',
  },
  {
    id: 'scheduler',
    position: new THREE.Vector3(-2.75, 0, -1.1),
    width: 2.15,
    height: 1.15,
    depth: 1.7,
    accent: 'amber',
    meta: 'Scheduler · ScheduleBatch',
  },
  {
    id: 'execution',
    position: new THREE.Vector3(0.45, 0, -0.1),
    width: 2.2,
    height: 1.25,
    depth: 1.75,
    accent: 'coral',
    meta: 'TpModelWorker / ModelRunner',
  },
  {
    id: 'cache',
    position: new THREE.Vector3(1.1, 0, 1.7),
    width: 2.4,
    height: 0.8,
    depth: 1.5,
    accent: 'lilac',
    meta: 'RadixCache · KV mapping',
  },
  {
    id: 'model',
    position: new THREE.Vector3(3.0, 0, -1.55),
    width: 1.75,
    height: 1.35,
    depth: 1.4,
    accent: 'mint',
    meta: 'Attention / kernels',
  },
  {
    id: 'detokenizer',
    position: new THREE.Vector3(6.5, 0, 0.35),
    width: 1.8,
    height: 0.95,
    depth: 1.5,
    accent: 'amber',
    meta: 'DetokenizerManager',
  },
];

const nodeTitle: Record<NodeId, string> = {
  api: 'API 接入',
  tokenizer: '分词与请求管理',
  scheduler: '调度与结果处理',
  execution: '执行封装与采样',
  cache: 'KV 管理',
  model: '模型与算子',
  detokenizer: '输出反分词',
};

const overviewLabelMeta: Record<NodeId, string> = {
  api: 'HTTP / OpenAI',
  tokenizer: 'TokenizerManager',
  scheduler: 'Scheduler',
  execution: 'Worker / Runner',
  cache: 'RadixCache + allocator',
  model: 'Attention backend',
  detokenizer: '独立进程',
};

const requestPositions: Record<string, THREE.Vector3> = {
  arrive: new THREE.Vector3(-8.55, 1.15, 0.35),
  tokenize: new THREE.Vector3(-5.45, 1.5, 1.25),
  schedule: new THREE.Vector3(-0.85, 1.35, 0.65),
  execute: new THREE.Vector3(0.45, 1.65, 0.5),
  result: new THREE.Vector3(-2.55, 1.5, -0.3),
  detokenize: new THREE.Vector3(6.15, 1.35, 0.8),
  complete: new THREE.Vector3(-7.7, 1.35, 1.2),
};

const activeModulesByStep: Record<string, NodeId[]> = {
  arrive: ['api'],
  tokenize: ['api', 'tokenizer', 'scheduler'],
  schedule: ['scheduler', 'cache'],
  execute: ['scheduler', 'execution', 'model', 'cache'],
  result: ['scheduler', 'execution'],
  detokenize: ['scheduler', 'detokenizer', 'tokenizer', 'api'],
  complete: ['scheduler', 'cache', 'api'],
};

function focusFor(node: NodeLayout): FocusPoint {
  const target = node.position.clone().add(new THREE.Vector3(0, 0.58, 0));
  const position = target.clone().add(new THREE.Vector3(3.8, 3.0, 4.6));
  return { target, position };
}

function createProcessPlate(
  width: number,
  depth: number,
  color: number,
  center: THREE.Vector3,
): THREE.Group {
  const group = new THREE.Group();
  const slabMaterial = standardMaterial(0x102528, {
    roughness: 0.78,
    metalness: 0.18,
    transparent: true,
    opacity: 0.72,
  });
  const slab = roundedBox(width, 0.14, depth, 0.16, slabMaterial);
  slab.position.copy(center);
  group.add(slab);
  const outlinePoints = [
    new THREE.Vector3(-width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, 0, depth / 2),
    new THREE.Vector3(-width / 2, 0, depth / 2),
    new THREE.Vector3(-width / 2, 0, -depth / 2),
  ].map((point) => point.add(center).add(new THREE.Vector3(0, 0.085, 0)));
  group.add(lineAlong(outlinePoints, color, 0.26));
  const dotGeometry = new THREE.BufferGeometry();
  const dotPositions: number[] = [];
  for (let x = -width / 2 + 0.5; x < width / 2; x += 1) {
    dotPositions.push(
      center.x + x,
      center.y + 0.09,
      center.z - depth / 2 + 0.16,
      center.x + x,
      center.y + 0.09,
      center.z + depth / 2 - 0.16,
    );
  }
  dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3));
  group.add(
    new THREE.Points(
      dotGeometry,
      new THREE.PointsMaterial({
        color,
        size: 0.028,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    ),
  );
  return group;
}

function createGround(): THREE.Group {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(16, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0a191b,
      roughness: 0.9,
      metalness: 0.05,
      transparent: true,
      opacity: 0.88,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.92;
  group.add(ground);

  const grid = new THREE.Group();
  for (let x = -16; x <= 16; x += 1) {
    const line = lineAlong(
      [new THREE.Vector3(x, -0.895, -8), new THREE.Vector3(x, -0.895, 8)],
      0x27504e,
      0.08,
    );
    grid.add(line);
  }
  for (let z = -8; z <= 8; z += 1) {
    const line = lineAlong(
      [new THREE.Vector3(-16, -0.895, z), new THREE.Vector3(16, -0.895, z)],
      0x27504e,
      0.08,
    );
    grid.add(line);
  }
  group.add(grid);

  for (const [radius, opacity] of [
    [6.6, 0.18],
    [8.8, 0.13],
    [11.2, 0.09],
  ] as const) {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i += 1) {
      const angle = (i / 96) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(angle) * radius, -0.89, Math.sin(angle) * radius),
      );
    }
    group.add(lineAlong(points, palette.line, opacity));
  }
  return group;
}

function createDust(): THREE.Points {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color(0xbfe8df);
  for (let i = 0; i < 110; i += 1) {
    const radius = 2.5 + Math.random() * 9;
    const angle = Math.random() * Math.PI * 2;
    positions.push(
      Math.cos(angle) * radius,
      0.15 + Math.random() * 4.2,
      Math.sin(angle) * radius * 0.75,
    );
    color.toArray(colors, colors.length);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.025,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
}

function buildRequestCard(): THREE.Group {
  const group = new THREE.Group();
  const cardMaterial = standardMaterial(0xf0e9db, {
    roughness: 0.64,
    metalness: 0.05,
    emissive: 0xd9a55f,
    emissiveIntensity: 0.05,
  });
  const card = roundedBox(0.46, 0.32, 0.055, 0.035, cardMaterial);
  card.rotation.set(-0.18, 0.32, 0.04);
  group.add(card);
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(0.052, 0.29, 0.064),
    new THREE.MeshBasicMaterial({ color: palette.coral }),
  );
  edge.position.set(-0.2, 0, 0.015);
  edge.rotation.copy(card.rotation);
  group.add(edge);
  const glow = glowSprite(palette.coral, 1.1, 0.6);
  glow.position.z = -0.04;
  group.add(glow);
  const orbit = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.008, 6, 64),
    new THREE.MeshBasicMaterial({
      color: palette.amber,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    }),
  );
  orbit.rotation.set(Math.PI / 2.3, 0.1, 0.4);
  group.add(orbit);
  group.scale.setScalar(1.15);
  return group;
}

function buildPrefixTree(): {
  group: THREE.Group;
  nodes: Array<{
    node: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
    depth: number;
  }>;
  edges: THREE.Line[];
} {
  const group = new THREE.Group();
  group.position.set(0.05, 1.05, 2.05);
  const nodes: Array<{
    node: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
    depth: number;
  }> = [];
  const edges: THREE.Line[] = [];
  const tree: Array<[number, number, number, number]> = [
    [0, 0, 0, 0],
    [-0.3, 0.2, -0.06, 1],
    [0.28, 0.24, 0.02, 1],
    [-0.5, 0.44, 0.05, 2],
    [-0.12, 0.48, -0.03, 2],
    [0.17, 0.51, 0.04, 2],
    [0.45, 0.46, -0.06, 2],
  ];
  const parent: number[] = [-1, 0, 0, 1, 1, 2, 2];
  for (let i = 0; i < tree.length; i += 1) {
    const [x, y, z, depth] = tree[i];
    const material = standardMaterial(palette.lilac, {
      emissive: palette.lilac,
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.1,
    });
    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.065, 0), material);
    node.position.set(x, y, z);
    group.add(node);
    nodes.push({ node, depth });
    if (parent[i] >= 0) {
      const p = tree[parent[i]];
      edges.push(
        lineAlong(
          [new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(x, y, z)],
          palette.lilac,
          0.35,
        ) as THREE.Line,
      );
    }
  }
  edges.forEach((edge) => group.add(edge));
  return { group, nodes, edges };
}

function addTopPlate(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  color: number,
): void {
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.025, depth),
    standardMaterial(0x102629, {
      roughness: 0.35,
      metalness: 0.5,
      emissive: color,
      emissiveIntensity: 0.08,
      transparent: true,
      opacity: 0.9,
    }),
  );
  plate.position.y = y;
  parent.add(plate);
}

function buildModule(layout: NodeLayout): NodeVisual {
  const accent = colorFor(layout.accent);
  const group = new THREE.Group();
  group.position.copy(layout.position);
  const baseMat = standardMaterial(0x11282c, {
    roughness: 0.55,
    metalness: 0.35,
    transparent: true,
    opacity: 0.94,
  });
  const platform = roundedBox(
    layout.width + 0.28,
    0.11,
    layout.depth + 0.28,
    0.07,
    baseMat,
  );
  platform.position.y = 0.055;
  group.add(platform);

  const body = roundedBox(
    layout.width,
    layout.height,
    layout.depth,
    0.09,
    standardMaterial(0x173237, {
      roughness: 0.48,
      metalness: 0.48,
      emissive: accent,
      emissiveIntensity: 0.025,
    }),
  );
  body.position.y = 0.16 + layout.height / 2;
  const edge = addEdges(group, body, accent, 0.26);

  const topPlate = roundedBox(
    layout.width * 0.84,
    0.045,
    layout.depth * 0.83,
    0.035,
    standardMaterial(0x1b3b3d, {
      roughness: 0.29,
      metalness: 0.65,
      emissive: accent,
      emissiveIntensity: 0.1,
    }),
  );
  topPlate.position.y = 0.17 + layout.height + 0.008;
  group.add(topPlate);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      Math.max(layout.width, layout.depth) * 0.52,
      Math.max(layout.width, layout.depth) * 0.56,
      64,
    ),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.008;
  group.add(ring);

  const glow = glowSprite(accent, Math.max(layout.width, layout.depth) * 1.45, 0.12);
  glow.position.y = 0.28;
  group.add(glow);

  let queueSlots: NodeVisual['queueSlots'];
  let kvCells: NodeVisual['kvCells'];
  let computeCells: NodeVisual['computeCells'];
  let tokenTiles: THREE.Object3D | undefined;
  let prefixNodes: NodeVisual['prefixNodes'];

  if (layout.id === 'api') {
    const port = new THREE.Mesh(
      new THREE.TorusGeometry(0.29, 0.055, 10, 32),
      standardMaterial(palette.cyan, {
        emissive: palette.cyan,
        emissiveIntensity: 0.35,
        roughness: 0.34,
        metalness: 0.4,
      }),
    );
    port.position.set(-0.24, 0.62, layout.depth / 2 + 0.03);
    group.add(port);
    for (let i = 0; i < 3; i += 1) {
      const card = new THREE.Mesh(
        new THREE.BoxGeometry(0.82, 0.24, 0.035),
        standardMaterial(0xd9d0c0, {
          roughness: 0.7,
          metalness: 0.04,
          emissive: palette.amber,
          emissiveIntensity: 0.04,
        }),
      );
      card.position.set(0.18, 0.35 + i * 0.3, layout.depth / 2 + 0.01);
      group.add(card);
    }
    const stub = tubeAlong(
      [
        new THREE.Vector3(-1.05, 0.62, 0.2),
        new THREE.Vector3(-0.82, 0.62, 0.2),
      ],
      0.04,
      palette.cyan,
      0.8,
    );
    group.add(stub);
  }

  if (layout.id === 'tokenizer') {
    for (let i = 0; i < 7; i += 1) {
      const token = new THREE.Mesh(
        new THREE.BoxGeometry(0.09 + (i % 3) * 0.035, 0.14 + (i % 2) * 0.07, 0.08),
        standardMaterial(palette.cyan, {
          emissive: palette.cyan,
          emissiveIntensity: 0.25,
          transparent: true,
          opacity: 0.9,
        }),
      );
      token.position.set(-0.66 + i * 0.21, 0.17 + layout.height + 0.1, 0.18);
      group.add(token);
    }
    tokenTiles = new THREE.Group();
    for (let i = 0; i < 5; i += 1) {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.04, 0.22),
        new THREE.MeshBasicMaterial({
          color: i === 2 ? palette.amber : palette.cyan,
          transparent: true,
          opacity: 0.85,
        }),
      );
      tile.position.set(-0.72 + i * 0.34, 0.5, layout.depth / 2 + 0.3);
      (tokenTiles as THREE.Group).add(tile);
    }
    group.add(tokenTiles);
  }

  if (layout.id === 'scheduler') {
    queueSlots = [];
    for (let i = 0; i < 4; i += 1) {
      const slotMaterial = standardMaterial(0x0d2327, {
        roughness: 0.55,
        metalness: 0.25,
        emissive: 0x000000,
        transparent: true,
        opacity: 0.9,
      });
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.58, 0.08), slotMaterial);
      slot.position.set(-0.45 + i * 0.33, 0.51, layout.depth / 2 + 0.02);
      slot.userData.activeColor = palette.amber;
      slot.userData.baseColor = 0x0d2327;
      group.add(slot);
      queueSlots.push(slot);
    }
    for (let i = 0; i < 5; i += 1) {
      const slat = new THREE.Mesh(
        new THREE.BoxGeometry(layout.width * 0.7, 0.025, 0.04),
        new THREE.MeshBasicMaterial({
          color: i === 1 ? palette.amber : palette.line,
          transparent: true,
          opacity: i === 1 ? 0.7 : 0.35,
        }),
      );
      slat.position.set(0, 0.38 + i * 0.08, -layout.depth / 2 - 0.02);
      group.add(slat);
    }
    addTopPlate(group, layout.width * 0.74, layout.depth * 0.48, 0.17 + layout.height + 0.05, palette.amber);
  }

  if (layout.id === 'execution') {
    const grid = cellGrid(4, 5, 0.2, 0.08, 0x3e5b52, palette.coral);
    grid.group.position.set(0, 0.18 + layout.height + 0.055, 0.04);
    grid.cells.forEach((cell) => {
      cell.userData.active = false;
    });
    group.add(grid.group);
    computeCells = grid.cells;
    const die = new THREE.Mesh(
      new THREE.BoxGeometry(layout.width * 0.9, 0.02, layout.depth * 0.9),
      new THREE.MeshBasicMaterial({
        color: palette.coral,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
    );
    die.position.y = 0.18 + layout.height + 0.02;
    group.add(die);
    for (let i = 0; i < 5; i += 1) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.42 + i * 0.03, layout.depth * 0.82),
        standardMaterial(0x35585a, {
          roughness: 0.38,
          metalness: 0.7,
          emissive: palette.coral,
          emissiveIntensity: 0.03,
        }),
      );
      fin.position.set(-layout.width * 0.38 + i * 0.22, 0.18 + layout.height + 0.18, -0.2);
      group.add(fin);
    }
  }

  if (layout.id === 'cache') {
    const grid = cellGrid(4, 8, 0.18, 0.055, 0x3c4b64, palette.lilac);
    grid.group.position.set(-0.15, 0.18 + layout.height + 0.045, 0.12);
    group.add(grid.group);
    kvCells = grid.cells;
    const tree = buildPrefixTree();
    tree.group.position.set(-0.8, 0.6, 0.22);
    group.add(tree.group);
    prefixNodes = tree.nodes;
    const addressRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.015, 8, 48),
      new THREE.MeshBasicMaterial({
        color: palette.lilac,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    );
    addressRing.rotation.x = Math.PI / 2;
    addressRing.position.set(0.75, 0.84, 0.13);
    group.add(addressRing);
  }

  if (layout.id === 'model') {
    for (let i = 0; i < 4; i += 1) {
      const layer = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.75 + i * 0.08, layout.depth * 0.78),
        standardMaterial(0x315b50, {
          roughness: 0.35,
          metalness: 0.6,
          emissive: palette.mint,
          emissiveIntensity: 0.035,
        }),
      );
      layer.position.set(-0.48 + i * 0.32, 0.18 + layout.height + 0.12, 0.06);
      group.add(layer);
    }
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.05, 1.0),
      standardMaterial(palette.mint, {
        roughness: 0.25,
        metalness: 0.55,
        emissive: palette.mint,
        emissiveIntensity: 0.18,
        transparent: true,
        opacity: 0.8,
      }),
    );
    chip.position.set(0.2, 0.18 + layout.height + 0.4, -0.05);
    chip.rotation.z = -0.08;
    group.add(chip);
  }

  if (layout.id === 'detokenizer') {
    for (let i = 0; i < 3; i += 1) {
      const points = [
        new THREE.Vector3(-layout.width / 2 + 0.28, 0.38 + i * 0.2, layout.depth / 2 - 0.08),
        new THREE.Vector3(-0.68, 0.4 + i * 0.16, layout.depth / 2 + 0.22),
        new THREE.Vector3(-0.98, 0.34 + i * 0.11, layout.depth / 2 + 0.45),
      ];
      const ribbon = tubeAlong(points, 0.012 + i * 0.006, i === 1 ? palette.amber : palette.paper, 0.55);
      group.add(ribbon);
    }
    const spool = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.7, 16),
      standardMaterial(0x85583b, {
        roughness: 0.5,
        metalness: 0.3,
        emissive: palette.amber,
        emissiveIntensity: 0.03,
      }),
    );
    spool.rotation.z = Math.PI / 2;
    spool.position.set(0.45, 0.18 + layout.height + 0.12, 0.1);
    group.add(spool);
  }

  const smallLight = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 12),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95 }),
  );
  smallLight.position.set(layout.width / 2 - 0.12, 0.2, layout.depth / 2 + 0.01);
  group.add(smallLight);

  markNode(group, layout.id);
  const focus = focusFor(layout);
  return {
    id: layout.id,
    group,
    ring,
    glow,
    edgeMaterial: edge.material as THREE.LineBasicMaterial,
    accent,
    focus,
    queueSlots,
    kvCells,
    computeCells,
    tokenTiles,
    prefixNodes,
  };
}

function addLink(
  scene: THREE.Scene,
  key: string,
  points: THREE.Vector3[],
  color: number,
  opacity = 0.65,
  radius = 0.018,
): { key: string; mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const mesh = tubeAlong(points, radius, color, opacity);
  mesh.userData.linkKey = key;
  scene.add(mesh);
  return { key, mesh, material: mesh.material as THREE.MeshBasicMaterial };
}

function addPathLine(scene: THREE.Scene): THREE.Line {
  const points = [
    new THREE.Vector3(-9.2, 1.14, 0.3),
    ...Object.values(requestPositions),
  ];
  const line = lineAlong(points, palette.amber, 0.14, true);
  line.visible = false;
  scene.add(line);
  return line as THREE.Line;
}

export class SglangMapScene implements SceneHandle {
  readonly scene = new THREE.Scene();
  readonly labels: OverlayLabelSpec[] = [];
  readonly focus: Record<string, FocusPoint> = {};
  readonly home: FocusPoint;
  private readonly mode: MapMode;
  private readonly reducedMotion: boolean;
  private readonly motion = new MotionRunner();
  private readonly nodes = new Map<NodeId, NodeVisual>();
  private readonly links = new Map<
    string,
    { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; baseColor: number }
  >();
  private readonly requestGroup: THREE.Group;
  private readonly requestPath: THREE.Line;
  private readonly gpuDeck: THREE.Object3D;
  private selectedNode: NodeId | null = null;
  private hoveredNode: NodeId | null = null;
  private currentStepId = 'map';
  private stepInitialized = false;
  private currentScenario = '';
  private activeNodeIds = new Set<NodeId>();

  constructor(mode: MapMode, reducedMotion: boolean) {
    this.mode = mode;
    this.reducedMotion = reducedMotion;
    this.scene.fog = new THREE.FogExp2(0x0b171b, 0.013);
    this.home = {
      target: new THREE.Vector3(0, 0.2, 0.3),
      position: new THREE.Vector3(13.2, 10.4, 15.2),
    };
    this.scene.add(createGround());
    this.scene.add(createDust());

    const entryPlate = createProcessPlate(
      4.35,
      4.25,
      palette.cyan,
      new THREE.Vector3(-6.55, -0.25, 0.62),
    );
    const schedulerPlate = createProcessPlate(
      8.45,
      5.7,
      palette.amber,
      new THREE.Vector3(-0.2, -0.25, 0.2),
    );
    const detokPlate = createProcessPlate(
      2.85,
      3.4,
      palette.amber,
      new THREE.Vector3(6.55, -0.25, 0.35),
    );
    this.scene.add(entryPlate, schedulerPlate, detokPlate);

    const gpu = new THREE.Group();
    const deck = roundedBox(
      6.7,
      0.08,
      4.15,
      0.14,
      standardMaterial(0x1b3a35, {
        roughness: 0.5,
        metalness: 0.28,
        emissive: palette.mint,
        emissiveIntensity: 0.035,
        transparent: true,
        opacity: 0.48,
      }),
    );
    deck.position.set(1.2, -0.1, 0.45);
    gpu.add(deck);
    const gpuBorder = [
      new THREE.Vector3(-2.15, -0.05, -1.62),
      new THREE.Vector3(4.55, -0.05, -1.62),
      new THREE.Vector3(4.55, -0.05, 2.52),
      new THREE.Vector3(-2.15, -0.05, 2.52),
      new THREE.Vector3(-2.15, -0.05, -1.62),
    ];
    gpu.add(lineAlong(gpuBorder, palette.mint, 0.2));
    this.scene.add(gpu);
    this.gpuDeck = gpu;

    const plateLabels: Array<{
      id: string;
      text: string;
      position: THREE.Vector3;
    }> = [
      {
        id: 'process.entry',
        text: '入口进程',
        position: new THREE.Vector3(-8.1, 0.02, 2.8),
      },
      {
        id: 'process.scheduler',
        text: '调度进程',
        position: new THREE.Vector3(-3.65, 0.02, 3.25),
      },
      {
        id: 'process.detok',
        text: '反分词进程',
        position: new THREE.Vector3(7.55, 0.02, 2.12),
      },
      {
        id: 'device.gpu',
        text: 'GPU 设备 · 不是进程',
        position: new THREE.Vector3(4.2, -0.02, 2.65),
      },
    ];
    for (const plate of plateLabels) {
      this.labels.push({
        id: plate.id,
        text: plate.text,
        kind: 'process',
        anchor: plate.position,
      });
    }

    for (const layout of nodeLayouts) {
      const visual = buildModule(layout);
      this.nodes.set(layout.id, visual);
      this.scene.add(visual.group);
      this.focus[layout.id] = visual.focus;
      this.labels.push({
        id: `label.${layout.id}`,
        text: nodeTitle[layout.id],
        meta: overviewLabelMeta[layout.id],
        nodeId: layout.id,
        kind: 'node',
        anchor: layout.position
          .clone()
          .add(new THREE.Vector3(0, 0.62 + layout.height + 0.65, 0)),
      });
    }

    this.addConnections();

    this.labels.push({
      id: 'state.pool',
      text: '设备 buffer',
      meta: 'KV 值不在网络载荷中',
      kind: 'state',
      anchor: new THREE.Vector3(1.55, 0.45, 2.75),
    });

    this.requestGroup = buildRequestCard();
    this.requestGroup.visible = false;
    this.scene.add(this.requestGroup);
    this.requestPath = addPathLine(this.scene);

    this.applyStep('map', true);
  }

  private addConnections(): void {
    const link = (
      key: string,
      points: THREE.Vector3[],
      color = palette.line,
      opacity = 0.5,
      radius = 0.018,
    ): void => {
      const created = addLink(this.scene, key, points, color, opacity, radius);
      this.links.set(key, {
        mesh: created.mesh,
        material: created.material,
        baseColor: color,
      });
    };
    link(
      'api-tokenizer',
      [
        new THREE.Vector3(-6.9, 0.72, 0.2),
        new THREE.Vector3(-6.45, 0.84, 0.85),
        new THREE.Vector3(-5.75, 0.75, 1.6),
      ],
      palette.cyan,
      0.55,
      0.026,
    );
    link(
      'tokenizer-scheduler',
      [
        new THREE.Vector3(-5.45, 0.72, 0.9),
        new THREE.Vector3(-4.85, 0.82, 0.25),
        new THREE.Vector3(-3.75, 0.78, -0.6),
      ],
      palette.amber,
      0.55,
      0.026,
    );
    link(
      'scheduler-execution',
      [
        new THREE.Vector3(-1.72, 0.7, -0.9),
        new THREE.Vector3(-0.7, 0.9, -0.55),
        new THREE.Vector3(-0.62, 0.7, -0.2),
      ],
      palette.coral,
      0.5,
      0.024,
    );
    link(
      'execution-model',
      [
        new THREE.Vector3(1.5, 0.9, -0.3),
        new THREE.Vector3(2.1, 1.05, -0.8),
        new THREE.Vector3(2.45, 0.82, -1.32),
      ],
      palette.mint,
      0.45,
      0.02,
    );
    link(
      'execution-cache',
      [
        new THREE.Vector3(0.9, 0.55, 0.8),
        new THREE.Vector3(1.0, 0.45, 1.35),
      ],
      palette.lilac,
      0.58,
      0.028,
    );
    link(
      'scheduler-cache',
      [
        new THREE.Vector3(-2.15, 0.45, 0.0),
        new THREE.Vector3(-1.3, 0.45, 1.4),
        new THREE.Vector3(-0.15, 0.48, 1.7),
      ],
      palette.lilac,
      0.38,
      0.016,
    );
    link(
      'scheduler-detok',
      [
        new THREE.Vector3(-1.65, 0.62, -0.85),
        new THREE.Vector3(2.2, 0.35, -0.85),
        new THREE.Vector3(5.4, 0.52, 0.1),
        new THREE.Vector3(5.7, 0.7, 0.5),
      ],
      palette.amber,
      0.42,
      0.018,
    );
    const returnLine = lineAlong(
      [
        new THREE.Vector3(6.5, 1.25, 0.0),
        new THREE.Vector3(5.6, 1.55, -2.1),
        new THREE.Vector3(-2.2, 1.65, -2.7),
        new THREE.Vector3(-5.7, 1.28, -1.8),
        new THREE.Vector3(-7.0, 1.08, -0.8),
      ],
      palette.line,
      0.18,
      true,
    );
    this.scene.add(returnLine);
  }

  setStep(context: StepRenderContext): void {
    const scenarioChanged = this.currentScenario !== context.scenario.id;
    this.currentScenario = context.scenario.id;
    this.currentStepId = context.step.id;
    const immediate = !this.stepInitialized || scenarioChanged;
    this.stepInitialized = true;
    this.applyStep(context.step.id, immediate);
  }

  setSelected(nodeId: string | null): void {
    this.selectedNode =
      nodeId && this.nodes.has(nodeId as NodeId) ? (nodeId as NodeId) : null;
    this.refreshNodeStates();
  }

  setHovered(nodeId: string | null): void {
    this.hoveredNode =
      nodeId && this.nodes.has(nodeId as NodeId) ? (nodeId as NodeId) : null;
    this.refreshNodeStates();
  }

  update(deltaSeconds: number): boolean {
    return this.motion.update(deltaSeconds);
  }

  dispose(): void {
    this.motion.clear();
  }

  private applyStep(stepId: string, immediate: boolean): void {
    this.motion.clear();
    const isFlow = this.mode === 'flow';
    this.requestGroup.visible = isFlow;
    this.requestPath.visible = isFlow;
    this.gpuDeck.visible = true;
    if (isFlow) {
      const target = requestPositions[stepId] ?? requestPositions.arrive;
      this.moveRequest(target, immediate);
    }
    this.activeNodeIds = new Set<NodeId>(
      isFlow
        ? (activeModulesByStep[stepId] ?? [])
        : nodeLayouts.map((layout) => layout.id),
    );
    this.refreshNodeStates();
    this.updateMechanismState(stepId, immediate);
    this.updateLinks(stepId);
    if (isFlow) {
      const api = this.nodes.get('api');
      const detok = this.nodes.get('detokenizer');
      if (stepId === 'complete' && api) {
        api.glow.material.opacity = 0.32;
      }
      if (detok && stepId === 'detokenize') {
        detok.glow.material.opacity = 0.3;
      }
    }
  }

  private moveRequest(target: THREE.Vector3, immediate: boolean): void {
    const from = this.requestGroup.position.clone();
    const to = target.clone();
    const fading = this.currentStepId === 'complete';
    this.requestGroup.visible = true;
    if (immediate || this.reducedMotion) {
      this.requestGroup.position.copy(to);
      this.requestGroup.scale.setScalar(fading ? 0.05 : 1.15);
      this.requestGroup.visible = !fading;
      return;
    }
    const control = from.clone().add(to).multiplyScalar(0.5);
    control.y = Math.max(from.y, to.y) + 1.15;
    this.motion.add(0.68, (t) => {
      const inv = 1 - t;
      this.requestGroup.position.set(
        inv * inv * from.x + 2 * inv * t * control.x + t * t * to.x,
        inv * inv * from.y + 2 * inv * t * control.y + t * t * to.y,
        inv * inv * from.z + 2 * inv * t * control.z + t * t * to.z,
      );
      this.requestGroup.scale.setScalar(fading ? Math.max(0.05, 1.15 * (1 - t)) : 1.15);
      if (fading && t > 0.97) {
        this.requestGroup.visible = false;
      }
    });
  }

  private refreshNodeStates(): void {
    for (const [id, visual] of this.nodes) {
      const isActive = this.activeNodeIds.has(id);
      const isSelected = this.selectedNode === id;
      const isHovered = this.hoveredNode === id;
      visual.ring.material.opacity = isSelected
        ? 0.94
        : isHovered
          ? 0.55
          : isActive
            ? 0.34
            : 0.11;
      visual.edgeMaterial.opacity = isSelected ? 0.72 : isHovered ? 0.5 : 0.22;
      visual.glow.material.opacity = isSelected ? 0.3 : isHovered ? 0.2 : 0.09;
      const targetScale = isSelected ? 1.025 : 1;
      if (visual.group.scale.x !== targetScale) {
        visual.group.scale.setScalar(targetScale);
      }
    }
  }

  private updateLinks(stepId: string): void {
    const activeLinks = new Set<string>();
    if (this.mode === 'flow') {
      if (stepId === 'arrive' || stepId === 'tokenize') {
        activeLinks.add('api-tokenizer');
      }
      if (stepId === 'tokenize') {
        activeLinks.add('tokenizer-scheduler');
      }
      if (stepId === 'schedule') {
        activeLinks.add('tokenizer-scheduler');
        activeLinks.add('scheduler-cache');
      }
      if (stepId === 'execute') {
        activeLinks.add('scheduler-execution');
        activeLinks.add('execution-model');
        activeLinks.add('execution-cache');
      }
      if (stepId === 'result') {
        activeLinks.add('scheduler-execution');
        activeLinks.add('scheduler-cache');
      }
      if (stepId === 'detokenize') {
        activeLinks.add('scheduler-detok');
      }
    }
    for (const [key, link] of this.links) {
      const active = activeLinks.has(key);
      link.material.color.setHex(active ? link.baseColor : 0x31524f);
      link.material.opacity = active ? 0.95 : 0.25;
      link.mesh.scale.setScalar(active ? 1.1 : 1);
    }
  }

  private updateMechanismState(stepId: string, immediate: boolean): void {
    if (this.mode !== 'flow') {
      return;
    }
    const resources = requestResources(stepId);

    const tokenizer = this.nodes.get('tokenizer');
    if (tokenizer?.tokenTiles) {
      tokenizer.tokenTiles.visible = stepId === 'tokenize';
    }
    const scheduler = this.nodes.get('scheduler');
    scheduler?.queueSlots?.forEach((slot, index) => {
      const occupied = resources.requestSlots > 0 && index === 1;
      setCellActive(slot, occupied);
    });
    const cache = this.nodes.get('cache');
    cache?.kvCells?.forEach((cell, index) => {
      const occupied = (resources.requestKv || resources.cachedKv) && [2, 3, 8, 9].includes(index);
      setCellActive(cell, occupied);
      if (resources.cachedKv && occupied) {
        cell.material.color.setHex(palette.mint);
        cell.material.emissive.setHex(palette.mint);
      }
    });
    cache?.prefixNodes?.forEach(({ node, depth }) => {
      const matched = (resources.requestKv || resources.cachedKv) && depth <= 2;
      node.material.emissiveIntensity = matched ? 0.9 : 0.12;
      node.material.opacity = matched ? 1 : 0.45;
      node.material.transparent = !matched;
      node.scale.setScalar(matched ? 1.15 : 0.82);
    });
    const execution = this.nodes.get('execution');
    execution?.computeCells?.forEach((cell, index) => {
      const active = stepId === 'execute' && index % 3 !== 1;
      cell.userData.active = active;
      setCellActive(cell, active);
    });
    if (stepId !== 'execute') {
      execution?.computeCells?.forEach((cell) => {
        cell.material.emissiveIntensity = 0;
      });
    } else if (!immediate) {
      this.motion.add(1.8, (t) => {
        execution?.computeCells?.forEach((cell, index) => {
          if (cell.userData.active) {
            cell.material.emissiveIntensity = 0.5 + Math.sin(t * Math.PI * 4 + index) * 0.3 + 0.4;
          }
        });
      });
    }
  }
}

export function createOverviewMapScene(reducedMotion: boolean): SceneHandle {
  return new SglangMapScene('atlas', reducedMotion);
}

export function createRequestFlowScene(reducedMotion: boolean): SceneHandle {
  return new SglangMapScene('flow', reducedMotion);
}
