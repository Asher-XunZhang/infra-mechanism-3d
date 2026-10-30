import * as THREE from 'three';
import type {
  FocusPoint,
  LaneDefinition,
  OverlayLabelSpec,
  SceneHandle,
  ScenePlaybackContext,
  StepRenderContext,
} from '../../../viewer/types';
import {
  MotionRunner,
  addEdges,
  cellGrid,
  glowSprite,
  lineAlong,
  markNode,
  markerRing,
  palette,
  roundedBox,
  setCellActive,
  setGroupOpacity,
  standardMaterial,
  tubeAlong,
} from '../../../viewer/three/toolkit';
import {
  derivePdVisualState,
  type PdHealth,
  type PdVisualState,
} from './pd-state';

interface PdNodeVisual {
  group: THREE.Object3D;
  ring?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  edgeMaterials: THREE.LineBasicMaterial[];
}

interface StatusBoard {
  sprite: THREE.Sprite;
  update: (state: PdVisualState) => void;
}

const POOL_ACTIVE_CELLS = [2, 3, 4, 9, 10, 15, 16, 21];

function focusAt(x: number, y: number, z: number): FocusPoint {
  const target = new THREE.Vector3(x, Math.max(0.45, y), z);
  return {
    target,
    position: target.clone().add(new THREE.Vector3(3.7, 3.3, 5.4)),
  };
}

function createGround(): THREE.Group {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(15, 96),
    new THREE.MeshStandardMaterial({
      color: 0x0a191b,
      roughness: 0.92,
      metalness: 0.04,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.58;
  group.add(ground);

  for (let x = -14; x <= 14; x += 1) {
    group.add(
      lineAlong(
        [
          new THREE.Vector3(x, -0.565, -7.5),
          new THREE.Vector3(x, -0.565, 7.5),
        ],
        0x27504e,
        0.055,
      ),
    );
  }
  for (let z = -7; z <= 7; z += 1) {
    group.add(
      lineAlong(
        [
          new THREE.Vector3(-14, -0.565, z),
          new THREE.Vector3(14, -0.565, z),
        ],
        0x27504e,
        0.055,
      ),
    );
  }
  return group;
}

function createProcessPlate(
  width: number,
  depth: number,
  color: number,
  center: THREE.Vector3,
  fill = 0x102528,
): THREE.Group {
  const group = new THREE.Group();
  const slab = roundedBox(
    width,
    0.14,
    depth,
    0.18,
    standardMaterial(fill, {
      roughness: 0.8,
      metalness: 0.16,
      transparent: true,
      opacity: 0.72,
    }),
  );
  slab.position.copy(center);
  group.add(slab);
  const outline = [
    new THREE.Vector3(-width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, 0, depth / 2),
    new THREE.Vector3(-width / 2, 0, depth / 2),
    new THREE.Vector3(-width / 2, 0, -depth / 2),
  ].map((point) => point.add(center).add(new THREE.Vector3(0, 0.075, 0)));
  group.add(lineAlong(outline, color, 0.28));
  return group;
}

function createStatusBoard(version: string): StatusBoard {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas unavailable for the PD status board');
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.2, 1.55, 1);

  const update = (state: PdVisualState): void => {
    const health = state.health;
    const accent =
      health === 'unhealthy'
        ? '#e08478'
        : health === 'busy'
          ? '#e1ab5a'
          : health === 'blocked'
            ? '#d98d88'
            : '#72d3c8';
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(8, 20, 23, 0.93)';
    context.strokeStyle = accent;
    context.lineWidth = 4;
    context.beginPath();
    context.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 22);
    context.fill();
    context.stroke();
    context.fillStyle = accent;
    context.fillRect(34, 40, 5, 26);
    context.font =
      '500 24px "SFMono-Regular", "Cascadia Mono", "Noto Sans Mono", monospace';
    context.fillStyle = '#9db1ab';
    context.fillText(`PD ROLE SWITCH / ${version}`, 54, 61);
    context.font =
      '600 42px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    context.fillStyle = '#f4eddf';
    const status = state.status.length > 27 ? `${state.status.slice(0, 26)}…` : state.status;
    context.fillText(status, 34, 132);
    context.font =
      '400 22px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    context.fillStyle = '#8fa59f';
    const detail =
      state.detail.length > 39 ? `${state.detail.slice(0, 38)}…` : state.detail;
    context.fillText(detail, 34, 190);
    texture.needsUpdate = true;
  };

  return { sprite, update };
}

function createHealthTower(): {
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  glow: THREE.Sprite;
} {
  const group = new THREE.Group();
  group.position.set(1.55, 0, 2.35);
  const base = roundedBox(
    0.5,
    0.12,
    0.5,
    0.05,
    standardMaterial(0x173237, { roughness: 0.5, metalness: 0.5 }),
  );
  base.position.y = 0.08;
  group.add(base);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 0.78, 12),
    standardMaterial(0x2a4b4a, { roughness: 0.4, metalness: 0.6 }),
  );
  post.position.y = 0.52;
  group.add(post);
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 20, 16),
    standardMaterial(palette.mint, {
      emissive: palette.mint,
      emissiveIntensity: 0.8,
      roughness: 0.25,
      metalness: 0.3,
    }),
  );
  core.position.y = 0.95;
  group.add(core);
  const glow = glowSprite(palette.mint, 1.25, 0.35);
  glow.position.y = 0.95;
  group.add(glow);
  return { group, core, glow };
}

function createGate(): {
  group: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  light: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
} {
  const group = new THREE.Group();
  group.position.set(-5.25, 0, -1.45);
  const materials: THREE.MeshStandardMaterial[] = [];
  for (const x of [-0.56, 0.56]) {
    const post = roundedBox(
      0.11,
      1.25,
      0.11,
      0.025,
      standardMaterial(0x31514f, { roughness: 0.4, metalness: 0.55 }),
    );
    post.position.set(x, 0.66, 0);
    group.add(post);
    materials.push(post.material as THREE.MeshStandardMaterial);
  }
  const bar = roundedBox(
    1.34,
    0.1,
    0.13,
    0.03,
    standardMaterial(0x31514f, { roughness: 0.4, metalness: 0.55 }),
  );
  bar.position.y = 1.28;
  group.add(bar);
  materials.push(bar.material as THREE.MeshStandardMaterial);
  const plate = roundedBox(
    0.8,
    0.26,
    0.06,
    0.02,
    standardMaterial(0x10282b, { roughness: 0.5, metalness: 0.4 }),
  );
  plate.position.set(0, 0.66, 0.1);
  group.add(plate);
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 16, 12),
    standardMaterial(palette.amber, {
      emissive: palette.amber,
      emissiveIntensity: 0.8,
      roughness: 0.25,
    }),
  );
  light.position.set(0, 0.66, 0.17);
  group.add(light);
  return { group, materials, light };
}

function createPrefixTree(): {
  group: THREE.Group;
  ghost: THREE.Group;
  nodes: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>[];
} {
  const group = new THREE.Group();
  group.position.set(-0.55, 0.14, -1.5);
  const tree: Array<[number, number, number, number]> = [
    [0, 0.2, 0, 0],
    [-0.34, 0.47, -0.08, 1],
    [0.33, 0.45, 0.05, 1],
    [-0.56, 0.76, 0.06, 2],
    [-0.16, 0.81, -0.05, 2],
    [0.18, 0.79, 0.08, 2],
    [0.51, 0.75, -0.08, 2],
  ];
  const parent = [-1, 0, 0, 1, 1, 2, 2];
  const nodes: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let index = 0; index < tree.length; index += 1) {
    const [x, y, z] = tree[index];
    const node = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.075, 0),
      standardMaterial(palette.lilac, {
        emissive: palette.lilac,
        emissiveIntensity: 0.35,
        roughness: 0.4,
        metalness: 0.1,
      }),
    );
    node.position.set(x, y, z);
    group.add(node);
    nodes.push(node);
    if (parent[index] >= 0) {
      const source = tree[parent[index]];
      group.add(
        lineAlong(
          [
            new THREE.Vector3(source[0], source[1], source[2]),
            new THREE.Vector3(x, y, z),
          ],
          palette.lilac,
          0.42,
        ),
      );
    }
  }
  const ghost = new THREE.Group();
  ghost.position.copy(group.position);
  const ghostPoints = [
    new THREE.Vector3(-0.56, 0.08, 0),
    new THREE.Vector3(0.51, 0.08, 0),
    new THREE.Vector3(0.51, 0.98, 0),
    new THREE.Vector3(-0.56, 0.98, 0),
    new THREE.Vector3(-0.56, 0.08, 0),
  ];
  ghost.add(lineAlong(ghostPoints, palette.rose, 0.5, true));
  ghost.add(
    new THREE.Mesh(
      new THREE.PlaneGeometry(0.98, 0.78),
      new THREE.MeshBasicMaterial({
        color: palette.rose,
        transparent: true,
        opacity: 0.035,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    ),
  );
  ghost.visible = false;
  return { group, ghost, nodes };
}

function createApiTower(isLegacy: boolean): {
  group: THREE.Group;
  screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  blocked: THREE.Group;
} {
  const group = new THREE.Group();
  group.position.set(-7.15, 0, -0.2);
  const accent = isLegacy ? palette.rose : palette.cyan;
  const base = roundedBox(
    1.05,
    0.14,
    1.05,
    0.06,
    standardMaterial(0x173237, { roughness: 0.5, metalness: 0.4 }),
  );
  base.position.y = 0.08;
  group.add(base);
  const body = roundedBox(
    0.92,
    1.18,
    0.86,
    0.07,
    standardMaterial(0x143136, {
      roughness: 0.45,
      metalness: 0.5,
      emissive: accent,
      emissiveIntensity: 0.035,
    }),
  );
  body.position.y = 0.74;
  group.add(body);
  addEdges(group, body, accent, 0.35);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.62, 0.3),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  screen.position.set(0, 0.83, 0.44);
  group.add(screen);
  const port = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.045, 10, 28),
    standardMaterial(accent, {
      emissive: accent,
      emissiveIntensity: 0.45,
      roughness: 0.3,
      metalness: 0.4,
    }),
  );
  port.position.set(-0.32, 0.55, 0.45);
  group.add(port);
  const blocked = new THREE.Group();
  blocked.add(
    lineAlong(
      [
        new THREE.Vector3(-0.35, 0.62, 0.46),
        new THREE.Vector3(0.35, 1.05, 0.46),
      ],
      palette.rose,
      0.85,
    ),
  );
  blocked.add(
    lineAlong(
      [
        new THREE.Vector3(0.35, 0.62, 0.46),
        new THREE.Vector3(-0.35, 1.05, 0.46),
      ],
      palette.rose,
      0.85,
    ),
  );
  blocked.visible = false;
  group.add(blocked);
  return { group, screen, blocked };
}

function createScheduler(): {
  group: THREE.Group;
  slats: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
} {
  const group = new THREE.Group();
  group.position.set(-3.1, 0, -0.45);
  const base = roundedBox(
    2.5,
    0.14,
    2.0,
    0.07,
    standardMaterial(0x11282c, { roughness: 0.58, metalness: 0.35 }),
  );
  base.position.y = 0.08;
  group.add(base);
  const body = roundedBox(
    2.26,
    0.92,
    1.74,
    0.08,
    standardMaterial(0x173237, {
      roughness: 0.48,
      metalness: 0.48,
      emissive: palette.amber,
      emissiveIntensity: 0.035,
    }),
  );
  body.position.y = 0.6;
  group.add(body);
  addEdges(group, body, palette.amber, 0.3);
  const slats: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let index = 0; index < 5; index += 1) {
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.035, 0.04),
      standardMaterial(0x31514f, {
        roughness: 0.4,
        metalness: 0.55,
        emissive: index === 2 ? palette.amber : 0x000000,
        emissiveIntensity: index === 2 ? 0.35 : 0,
      }),
    );
    slat.position.set(0, 0.38 + index * 0.11, 0.9);
    group.add(slat);
    slats.push(slat);
  }
  const core = roundedBox(
    0.42,
    0.2,
    0.34,
    0.04,
    standardMaterial(0x214144, { roughness: 0.4, metalness: 0.6 }),
  );
  core.position.set(0.62, 1.14, 0);
  group.add(core);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.02, 0.35, 8),
    standardMaterial(palette.cyan, { emissive: palette.cyan, emissiveIntensity: 0.4 }),
  );
  antenna.position.set(0.62, 1.42, 0);
  group.add(antenna);
  return { group, slats };
}

function createOldQueue(): {
  group: THREE.Group;
  slots: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
} {
  const group = new THREE.Group();
  group.position.set(-4.4, 0, 2.25);
  const base = roundedBox(
    2.05,
    0.12,
    1.05,
    0.05,
    standardMaterial(0x1b2828, { roughness: 0.65, metalness: 0.22 }),
  );
  base.position.y = 0.08;
  group.add(base);
  const slots: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  for (let index = 0; index < 4; index += 1) {
    const slot = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.58, 0.5),
      standardMaterial(0x0d2327, {
        roughness: 0.55,
        metalness: 0.25,
        emissive: 0x000000,
        transparent: true,
        opacity: 0.9,
      }),
    );
    slot.position.set(-0.72 + index * 0.48, 0.43, 0);
    slot.userData.baseColor = 0x0d2327;
    slot.userData.activeColor = palette.amber;
    group.add(slot);
    slots.push(slot);
  }
  for (const x of [-0.9, 0.9]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.82, 0.72),
      standardMaterial(0x3b5148, { roughness: 0.45, metalness: 0.5 }),
    );
    rail.position.set(x, 0.48, 0);
    group.add(rail);
  }
  return { group, slots };
}

function createNewStructure(): {
  group: THREE.Group;
  blocks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  crack: THREE.Group;
} {
  const group = new THREE.Group();
  group.position.set(-1.75, 0, 2.25);
  const base = roundedBox(
    1.9,
    0.12,
    1.05,
    0.05,
    standardMaterial(0x0e2a2b, { roughness: 0.55, metalness: 0.3 }),
  );
  base.position.y = 0.08;
  group.add(base);
  const blocks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  const specs: Array<[number, number, number, number]> = [
    [-0.55, 0.44, 0.32, 0.62],
    [0, 0.62, 0.32, 0.86],
    [0.55, 0.4, 0.32, 0.58],
  ];
  for (const [x, width, height, depth] of specs) {
    const material = standardMaterial(0x2a5148, {
      roughness: 0.4,
      metalness: 0.45,
      emissive: palette.mint,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.94,
    });
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material,
    );
    block.position.set(x, 0.18 + height / 2, 0);
    group.add(block);
    blocks.push(block);
    addEdges(
      group,
      block,
      palette.mint,
      0.35,
    );
  }
  const crack = new THREE.Group();
  crack.add(
    lineAlong(
      [
        new THREE.Vector3(-0.2, 0.25, 0.17),
        new THREE.Vector3(0.04, 0.6, 0.17),
        new THREE.Vector3(-0.12, 0.94, 0.17),
      ],
      palette.rose,
      0.95,
    ),
  );
  crack.add(
    lineAlong(
      [
        new THREE.Vector3(0.04, 0.6, 0.17),
        new THREE.Vector3(0.3, 0.75, 0.17),
      ],
      palette.rose,
      0.95,
    ),
  );
  crack.visible = false;
  group.add(crack);
  return { group, blocks, crack };
}

function createPool(): {
  group: THREE.Group;
  cells: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
} {
  const group = new THREE.Group();
  group.position.set(5.9, 0, 0.3);
  const base = roundedBox(
    3.9,
    0.14,
    2.85,
    0.09,
    standardMaterial(0x10302d, {
      roughness: 0.45,
      metalness: 0.35,
      emissive: palette.mint,
      emissiveIntensity: 0.03,
    }),
  );
  base.position.y = 0.08;
  group.add(base);
  const frame = [
    new THREE.Vector3(-1.92, 0.16, -1.38),
    new THREE.Vector3(1.92, 0.16, -1.38),
    new THREE.Vector3(1.92, 0.16, 1.38),
    new THREE.Vector3(-1.92, 0.16, 1.38),
    new THREE.Vector3(-1.92, 0.16, -1.38),
  ];
  group.add(lineAlong(frame, palette.mint, 0.35));
  const grid = cellGrid(4, 7, 0.38, 0.095, 0x334b45, palette.mint);
  grid.group.position.set(0, 0.2, 0);
  group.add(grid.group);
  return { group, cells: grid.cells };
}

function createSupervisorRing(): {
  group: THREE.Group;
  arrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
} {
  const group = new THREE.Group();
  group.position.set(-3.35, 0.08, -2.5);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.028, 8, 64, Math.PI * 1.72),
    new THREE.MeshBasicMaterial({
      color: palette.cyan,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.24, 10),
    standardMaterial(palette.cyan, {
      emissive: palette.cyan,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    }),
  );
  arrow.position.set(0.74, 0.04, 0.05);
  arrow.rotation.z = -Math.PI / 2;
  group.add(arrow);
  return { group, arrow };
}

function createRequestCards(): THREE.Group {
  const group = new THREE.Group();
  const positions: Array<[number, number, number, number]> = [
    [-0.52, 1.0, 0.26, -0.1],
    [0, 1.08, 0.32, 0.03],
    [0.52, 0.98, 0.24, 0.12],
  ];
  for (const [x, y, z, rotation] of positions) {
    const card = roundedBox(
      0.22,
      0.3,
      0.035,
      0.025,
      standardMaterial(0xf0e9db, {
        roughness: 0.65,
        metalness: 0.04,
        emissive: palette.coral,
        emissiveIntensity: 0.05,
      }),
    );
    card.position.set(x, y, z);
    card.rotation.set(-0.12, rotation, 0.04);
    group.add(card);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.24, 0.04),
      new THREE.MeshBasicMaterial({ color: palette.coral }),
    );
    stripe.position.set(-0.075, y, z + 0.02);
    stripe.rotation.copy(card.rotation);
    group.add(stripe);
  }
  group.position.set(-4.4, 0.35, 3.05);
  return group;
}

export class SglangPdScene implements SceneHandle {
  readonly scene = new THREE.Scene();
  readonly labels: OverlayLabelSpec[] = [];
  readonly focus: Record<string, FocusPoint> = {};
  readonly home: FocusPoint = {
    target: new THREE.Vector3(-0.2, 0.45, 0.1),
    position: new THREE.Vector3(4.9, 13.2, 24.2),
  };
  private readonly lane: LaneDefinition;
  private readonly reducedMotion: boolean;
  private readonly motion = new MotionRunner();
  private readonly nodes = new Map<string, PdNodeVisual>();
  private readonly labelSpecs = new Map<string, OverlayLabelSpec>();
  private readonly fadeTokens = new WeakMap<THREE.Object3D, number>();
  private readonly stateBoard: StatusBoard;
  private readonly oldQueue: THREE.Group;
  private readonly oldQueueSlots: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  private readonly newStructure: THREE.Group;
  private readonly newBlocks: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  private readonly newCrack: THREE.Group;
  private readonly prefix: THREE.Group;
  private readonly prefixGhost: THREE.Group;
  private readonly prefixNodes: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>[];
  private readonly requestCards: THREE.Group;
  private readonly poolCells: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[];
  private readonly gate: THREE.Group;
  private readonly gateMaterials: THREE.MeshStandardMaterial[];
  private readonly gateLight: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly graphChip: THREE.Group;
  private readonly apiScreen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly apiBlocked: THREE.Group;
  private readonly apiPort: THREE.Mesh;
  private readonly health: THREE.Group;
  private readonly healthCore: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly healthGlow: THREE.Sprite;
  private readonly supervisor: THREE.Group;
  private readonly supervisorArrow: THREE.Mesh<THREE.ConeGeometry, THREE.MeshStandardMaterial>;
  private readonly legacy: boolean;
  private selectedNode: string | null = null;
  private hoveredNode: string | null = null;
  private currentScenario = '';
  private initialized = false;

  constructor(lane: LaneDefinition, reducedMotion: boolean) {
    this.lane = lane;
    this.reducedMotion = reducedMotion;
    this.legacy = lane.id === 'v0520';
    this.scene.fog = new THREE.FogExp2(0x0b171b, 0.012);
    this.scene.add(createGround());

    this.scene.add(
      createProcessPlate(
        11.2,
        6.2,
        this.legacy ? palette.rose : palette.cyan,
        new THREE.Vector3(-2.45, -0.35, 0.55),
      ),
    );
    this.scene.add(
      createProcessPlate(
        5.25,
        5.7,
        palette.mint,
        new THREE.Vector3(5.9, -0.35, 0.55),
        0x102923,
      ),
    );

    const boundary = [
      new THREE.Vector3(3.08, -0.24, -2.7),
      new THREE.Vector3(3.08, -0.24, 3.2),
    ];
    this.scene.add(lineAlong(boundary, palette.mint, 0.32, true));
    this.scene.add(
      tubeAlong(
        [
          new THREE.Vector3(3.08, -0.18, 0.3),
          new THREE.Vector3(3.08, 0.28, 0.3),
        ],
        0.012,
        palette.mint,
        0.35,
      ),
    );

    const api = createApiTower(this.legacy);
    this.scene.add(api.group);
    this.apiScreen = api.screen;
    this.apiBlocked = api.blocked;
    this.apiBlocked.visible = this.legacy;
    this.apiPort = api.group.children.find(
      (child) => child instanceof THREE.Mesh && child.geometry.type === 'TorusGeometry',
    ) as THREE.Mesh;
    if (!this.legacy) {
      markNode(api.group, 'pd.http');
      this.registerNode('pd.http', api.group, palette.cyan, api.group.position, 1.2);
    } else {
      markNode(api.group, 'pd.http');
      this.registerNode('pd.http', api.group, palette.rose, api.group.position, 1.2);
    }

    const gate = createGate();
    this.gate = gate.group;
    this.gateMaterials = gate.materials;
    this.gateLight = gate.light;
    this.gate.visible = !this.legacy;
    this.scene.add(this.gate);
    if (!this.legacy) {
      markNode(this.gate, 'pd.guard');
      this.registerNode('pd.guard', this.gate, palette.amber, new THREE.Vector3(-5.25, 0.4, -1.45), 1.3);
    }

    const scheduler = createScheduler();
    this.scene.add(scheduler.group);
    if (!this.legacy) {
      markNode(scheduler.group, 'pd.scheduler');
      this.registerNode('pd.scheduler', scheduler.group, palette.amber, new THREE.Vector3(-3.1, 0.6, -0.45), 2.0);
    }

    const oldQueue = createOldQueue();
    this.oldQueue = oldQueue.group;
    this.oldQueueSlots = oldQueue.slots;
    this.scene.add(this.oldQueue);
    if (!this.legacy) {
      markNode(this.oldQueue, 'pd.teardown');
      this.registerNode('pd.teardown', this.oldQueue, palette.amber, new THREE.Vector3(-4.4, 0.4, 2.25), 1.5);
    }

    const createdNew = createNewStructure();
    this.newStructure = createdNew.group;
    this.newBlocks = createdNew.blocks;
    this.newCrack = createdNew.crack;
    this.newStructure.visible = false;
    this.scene.add(this.newStructure);
    if (!this.legacy) {
      markNode(this.newStructure, 'pd.rebuild');
      this.registerNode('pd.rebuild', this.newStructure, palette.mint, new THREE.Vector3(-1.75, 0.5, 2.25), 1.5);
    }

    const prefix = createPrefixTree();
    this.prefix = prefix.group;
    this.prefixGhost = prefix.ghost;
    this.prefixNodes = prefix.nodes;
    this.scene.add(this.prefix, this.prefixGhost);
    if (!this.legacy) {
      markNode(this.prefix, 'pd.prefix');
      this.registerNode('pd.prefix', this.prefix, palette.lilac, new THREE.Vector3(-0.55, 0.55, -1.5), 1.2);
      this.prefixGhost.visible = false;
    } else {
      this.prefixGhost.visible = false;
    }

    const pool = createPool();
    this.poolCells = pool.cells;
    this.scene.add(pool.group);
    markNode(pool.group, 'pd.pool');
    this.registerNode('pd.pool', pool.group, palette.mint, new THREE.Vector3(5.9, 0.55, 0.3), 2.4);

    const health = createHealthTower();
    this.health = health.group;
    this.healthCore = health.core;
    this.healthGlow = health.glow;
    this.health.visible = false;
    this.scene.add(this.health);
    if (!this.legacy) {
      markNode(this.health, 'pd.health');
      this.registerNode('pd.health', this.health, palette.rose, new THREE.Vector3(1.55, 0.8, 2.35), 0.9);
    }

    const supervisor = createSupervisorRing();
    this.supervisor = supervisor.group;
    this.supervisorArrow = supervisor.arrow;
    this.supervisor.visible = this.legacy;
    this.scene.add(this.supervisor);
    if (this.legacy) {
      markNode(this.supervisor, 'pd.legacy_loop');
      this.registerNode('pd.legacy_loop', this.supervisor, palette.rose, new THREE.Vector3(-3.35, 0.4, -2.5), 1.1);
      this.focus['pd.supervisor'] = this.focus['pd.legacy_loop'];
      this.focus['pd.scheduler'] = this.focus['pd.legacy_loop'];
      this.focus['pd.rebuild'] = focusAt(5.9, 0.6, 0.3);
    } else {
      markNode(this.supervisor, 'pd.supervisor');
      this.registerNode('pd.supervisor', this.supervisor, palette.cyan, new THREE.Vector3(-3.35, 0.35, -2.5), 1.1);
    }

    const graphChip = new THREE.Group();
    graphChip.position.set(-6.05, 0, -2.55);
    const chipBase = roundedBox(
      0.78,
      0.1,
      0.58,
      0.04,
      standardMaterial(0x122b2e, { roughness: 0.5, metalness: 0.3 }),
    );
    chipBase.position.y = 0.08;
    graphChip.add(chipBase);
    for (let index = 0; index < 3; index += 1) {
      const cell = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.24, 0.05),
        standardMaterial(0x31514f, {
          roughness: 0.45,
          metalness: 0.3,
          emissive: palette.lilac,
          emissiveIntensity: 0.12,
          transparent: true,
          opacity: 0.75,
        }),
      );
      cell.position.set(-0.22 + index * 0.22, 0.27, 0);
      graphChip.add(cell);
    }
    this.graphChip = graphChip;
    this.graphChip.visible = false;
    this.scene.add(this.graphChip);
    if (!this.legacy) {
      markNode(this.graphChip, 'pd.graph');
      this.registerNode('pd.graph', this.graphChip, palette.lilac, new THREE.Vector3(-6.05, 0.2, -2.55), 0.7);
    }

    const idle = new THREE.Group();
    idle.position.set(-4.2, 0, -2.15);
    const idlePost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, 0.82, 10),
      standardMaterial(0x2a4b4a, { roughness: 0.4, metalness: 0.5 }),
    );
    idlePost.position.y = 0.46;
    idle.add(idlePost);
    const idleHead = roundedBox(
      0.36,
      0.22,
      0.24,
      0.03,
      standardMaterial(0x173237, {
        roughness: 0.45,
        metalness: 0.4,
        emissive: palette.rose,
        emissiveIntensity: 0.1,
      }),
    );
    idleHead.position.y = 0.94;
    idle.add(idleHead);
    this.scene.add(idle);
    if (!this.legacy) {
      markNode(idle, 'pd.idle');
      this.registerNode('pd.idle', idle, palette.rose, new THREE.Vector3(-4.2, 0.55, -2.15), 0.6);
    }

    this.requestCards = createRequestCards();
    this.requestCards.visible = false;
    this.scene.add(this.requestCards);

    const board = createStatusBoard(this.legacy ? 'v0.5.20' : 'v0.5.21');
    this.stateBoard = board;
    this.stateBoard.sprite.position.set(0.55, 4.15, -0.5);
    this.scene.add(this.stateBoard.sprite);
    // The same state is readable in the DOM lane footer and guide.
    // A world-space paragraph becomes illegible in a narrow comparison lane.
    this.stateBoard.sprite.visible = false;

    this.addLabels();
    this.applyState(derivePdVisualState('normal', 'drain', lane.id), true);
  }

  private registerNode(
    id: string,
    group: THREE.Object3D,
    accent: number,
    position: THREE.Vector3,
    radius: number,
  ): void {
    const ring = markerRing(radius, accent, 0.2);
    ring.position.set(
      position.x - group.position.x,
      0.025,
      position.z - group.position.z,
    );
    group.add(ring);
    const edgeMaterials: THREE.LineBasicMaterial[] = [];
    group.traverse((child) => {
      const material = (child as THREE.LineSegments).material;
      if (material instanceof THREE.LineBasicMaterial) {
        edgeMaterials.push(material);
      }
    });
    this.nodes.set(id, { group, ring, edgeMaterials });
    const focus = focusAt(position.x, position.y + 0.2, position.z);
    this.focus[id] = focus;
    this.focus[id.replace('pd.', '')] = focus;
  }

  private addLabels(): void {
    const push = (spec: OverlayLabelSpec): void => {
      this.labels.push(spec);
      if (spec.nodeId) {
        this.labelSpecs.set(spec.nodeId, spec);
      }
    };

    push({
      id: 'process.host',
      text: '调度进程 · 主机侧',
      meta: '队列 / 元数据 / 控制路径',
      kind: 'process',
      anchor: new THREE.Vector3(-7.9, 0.06, 3.05),
    });
    push({
      id: 'device.gpu',
      text: 'GPU 设备 · 不是进程',
      meta: '物理 token KV pool',
      kind: 'process',
      anchor: new THREE.Vector3(7.45, 0.06, 3.0),
    });
    push({
      id: 'boundary.host-device',
      text: '主机 / 设备边界',
      meta: '池保留，管理结构重建',
      kind: 'state',
      anchor: new THREE.Vector3(3.08, 0.16, -2.95),
    });

    push({
      id: 'label.pd.http',
      text: this.legacy ? '无此管理路径' : '管理 API 入口',
      meta: this.legacy ? '旧版仍有 PD / PDMux' : 'POST /pd_role_switch',
      nodeId: 'pd.http',
      kind: 'node',
      anchor: new THREE.Vector3(-7.15, 2.15, -0.2),
    });

    if (!this.legacy) {
      push({
        id: 'label.pd.guard',
        text: '切换门槛',
        meta: '健康 / 重入 / 后端 / staging',
        nodeId: 'pd.guard',
        kind: 'node',
        anchor: new THREE.Vector3(-5.25, 1.85, -1.45),
      });
      push({
        id: 'label.pd.idle',
        text: '空闲检查',
        meta: 'is_fully_idle()',
        nodeId: 'pd.idle',
        kind: 'node',
        anchor: new THREE.Vector3(-4.2, 1.55, -2.15),
      });
      push({
        id: 'label.pd.graph',
        text: 'Graph 余量',
        meta: '本例假定通过',
        nodeId: 'pd.graph',
        kind: 'node',
        anchor: new THREE.Vector3(-6.05, 1.05, -2.55),
      });
      push({
        id: 'label.pd.scheduler',
        text: 'Scheduler 控制路径',
        meta: '控制请求分发',
        nodeId: 'pd.scheduler',
        kind: 'node',
        anchor: new THREE.Vector3(-3.1, 2.15, -0.45),
      });
      push({
        id: 'label.pd.teardown',
        text: '旧角色结构',
        meta: '队列 / 传输 / 元数据',
        nodeId: 'pd.teardown',
        kind: 'node',
        anchor: new THREE.Vector3(-4.4, 1.35, 2.25),
      });
      push({
        id: 'label.pd.prefix',
        text: '前缀与映射',
        meta: '切换时 reset / clear',
        nodeId: 'pd.prefix',
        kind: 'node',
        anchor: new THREE.Vector3(-0.55, 1.3, -1.5),
      });
      push({
        id: 'label.pd.pool',
        text: '物理 token KV pool',
        meta: '角色无关 · 容量保留',
        nodeId: 'pd.pool',
        kind: 'node',
        anchor: new THREE.Vector3(5.9, 1.7, 0.3),
      });
      push({
        id: 'label.pd.rebuild',
        text: '新角色结构',
        meta: 'role flip + init + sync',
        nodeId: 'pd.rebuild',
        kind: 'node',
        anchor: new THREE.Vector3(-1.75, 1.45, 2.25),
      });
      push({
        id: 'label.pd.supervisor',
        text: '循环重分派',
        meta: 'supervisor · 同进程',
        nodeId: 'pd.supervisor',
        kind: 'node',
        anchor: new THREE.Vector3(-3.35, 1.25, -2.5),
      });
      push({
        id: 'label.pd.health',
        text: '失败后置状态',
        meta: 'unhealthy · 需重启',
        nodeId: 'pd.health',
        kind: 'node',
        anchor: new THREE.Vector3(1.55, 1.65, 2.35),
      });
    } else {
      push({
        id: 'label.pd.legacy_loop',
        text: '启动时固定角色循环',
        meta: 'dispatch_event_loop',
        nodeId: 'pd.legacy_loop',
        kind: 'node',
        anchor: new THREE.Vector3(-3.35, 1.25, -2.5),
      });
      push({
        id: 'label.pd.pool',
        text: '物理 token KV pool',
        meta: '旧版原本存在的设备资源',
        nodeId: 'pd.pool',
        kind: 'node',
        anchor: new THREE.Vector3(5.9, 1.7, 0.3),
      });
      push({
        id: 'state.legacy',
        text: '固定角色 · 无运行时重分派',
        meta: '不是“没有 PD / PDMux”',
        kind: 'state',
        anchor: new THREE.Vector3(-3.35, 2.5, -2.5),
      });
    }

    for (const spec of this.labels) {
      if (spec.nodeId) {
        spec.visible = false;
      }
    }
  }

  setStep(context: StepRenderContext): void {
    const scenarioChanged = this.currentScenario !== context.scenario.id;
    const next = derivePdVisualState(
      context.scenario.id,
      context.step.id,
      this.lane.id,
    );
    const immediate = !this.initialized || scenarioChanged;
    this.initialized = true;
    this.currentScenario = context.scenario.id;
    this.applyState(next, immediate);
  }

  /** Structural transitions share the viewer clock; result boards commit at the boundary. */
  setPlayback(context: ScenePlaybackContext): void {
    const before = derivePdVisualState(context.scenario.id, context.previousStep.id, this.lane.id);
    const after = derivePdVisualState(context.scenario.id, context.step.id, this.lane.id);
    const progress = Math.max(0, Math.min(1, context.progress));
    this.applyState(progress < 1 ? before : after, true);
    if (progress < 1 && !context.reducedMotion) {
      const t = progress * progress * (3 - 2 * progress);
      const blend = (group: THREE.Object3D, from: boolean, to: boolean) => {
        if (from === to) return;
        setGroupOpacity(group, Number(from) + (Number(to) - Number(from)) * t);
      };
      blend(this.oldQueue, before.oldStructure === 'present', after.oldStructure === 'present');
      blend(this.prefix, before.prefix === 'present', after.prefix === 'present');
      blend(this.prefixGhost, before.prefix === 'reset', after.prefix === 'reset');
      blend(this.newStructure, before.newStructure !== 'none', after.newStructure !== 'none');
      blend(this.requestCards, before.requestCount > 0, after.requestCount > 0);
      if (before.supervisor !== after.supervisor) {
        blend(this.supervisor, this.legacy || before.supervisor === 'active', this.legacy || after.supervisor === 'active');
      }
    }
    this.motion.clear();
  }

  setSelected(nodeId: string | null): void {
    this.selectedNode = nodeId && this.nodes.has(nodeId) ? nodeId : null;
    this.refreshEmphasis();
  }

  setHovered(nodeId: string | null): void {
    this.hoveredNode = nodeId && this.nodes.has(nodeId) ? nodeId : null;
    this.refreshEmphasis();
  }

  update(deltaSeconds: number): boolean {
    return this.motion.update(deltaSeconds);
  }

  dispose(): void {
    this.motion.clear();
  }

  private applyState(state: PdVisualState, immediate: boolean): void {
    this.motion.clear();
    this.stateBoard.update(state);

    this.fadeGroup(this.oldQueue, state.oldStructure === 'present', immediate);
    this.oldQueueSlots.forEach((slot, index) => {
      setCellActive(slot, index < state.oldQueueOccupied);
    });

    this.fadeGroup(this.prefix, state.prefix === 'present', immediate);
    this.fadeGroup(this.prefixGhost, state.prefix === 'reset', immediate);
    this.prefixNodes.forEach((node) => {
      node.rotation.y = state.prefix === 'present' ? 0 : Math.PI / 2;
    });

    this.fadeGroup(
      this.newStructure,
      state.newStructure !== 'none',
      immediate,
    );
    this.newCrack.visible = state.newStructure === 'broken';
    this.newBlocks.forEach((block) => {
      const material = block.material as THREE.MeshStandardMaterial;
      if (state.newStructure === 'broken') {
        material.color.setHex(0x432f30);
        material.emissive.setHex(palette.rose);
        material.emissiveIntensity = 0.5;
      } else {
        material.color.setHex(0x2a5148);
        material.emissive.setHex(palette.mint);
        material.emissiveIntensity = 0.18;
      }
    });

    this.fadeGroup(this.requestCards, state.requestCount > 0, immediate);
    this.requestCards.children.forEach((child, index) => {
      const cardIndex = Math.floor(index / 2);
      child.visible = cardIndex < state.requestCount;
    });

    this.poolCells.forEach((cell, index) => {
      const occupied =
        state.poolOccupied > 0 && POOL_ACTIVE_CELLS.includes(index);
      setCellActive(cell, occupied);
    });

    this.gate.visible = !this.legacy;
    this.graphChip.visible =
      !this.legacy && (state.phase === 'guard' || state.phase === 'guards-pass');
    const gateColor =
      state.gate === 'reject'
        ? palette.rose
        : state.gate === 'pass'
          ? palette.mint
          : palette.amber;
    for (const material of this.gateMaterials) {
      material.emissive.setHex(gateColor);
      material.emissiveIntensity = state.gate === 'idle' ? 0.03 : 0.16;
    }
    this.gateLight.material.color.setHex(gateColor);
    this.gateLight.material.emissive.setHex(gateColor);
    this.gateLight.material.emissiveIntensity =
      state.gate === 'idle' ? 0.5 : 1.35;

    this.apiBlocked.visible = this.legacy;
    const apiColor =
      state.api === 'blocked'
        ? palette.rose
        : state.api === 'active'
          ? palette.cyan
          : 0x53706c;
    this.apiScreen.material.color.setHex(apiColor);
    this.apiScreen.material.opacity = state.api === 'active' ? 0.95 : 0.4;
    this.apiPort.visible = state.api !== 'blocked';

    const healthColor: Record<PdHealth, number> = {
      ok: palette.mint,
      busy: palette.amber,
      unhealthy: palette.rose,
      blocked: palette.rose,
    };
    const color = healthColor[state.health];
    this.health.visible =
      !this.legacy &&
      (state.health === 'busy' ||
        state.health === 'unhealthy' ||
        state.phase === 'supervise');
    this.healthCore.material.color.setHex(color);
    this.healthCore.material.emissive.setHex(color);
    this.healthCore.material.emissiveIntensity =
      state.health === 'unhealthy' ? 1.4 : 0.7;
    this.healthGlow.material.color.setHex(color);
    this.healthGlow.material.opacity = state.health === 'unhealthy' ? 0.55 : 0.3;

    const supervisorVisible = this.legacy || state.supervisor === 'active';
    this.supervisor.visible = supervisorVisible;
    this.supervisorArrow.material.emissiveIntensity =
      state.supervisor === 'active' ? 1.1 : 0.35;
    this.supervisorArrow.rotation.y =
      state.supervisor === 'active' ? Math.PI * 0.25 : 0;

    this.updateLabelVisibility(state);
    this.refreshEmphasis();

    if (!immediate && !this.reducedMotion) {
      this.motion.add(1.1, (progress) => {
        const strength = Math.sin(progress * Math.PI);
        if (state.poolOccupied > 0) {
          this.poolCells.forEach((cell, index) => {
            if (POOL_ACTIVE_CELLS.includes(index)) {
              cell.material.emissiveIntensity = 0.7 + strength * 0.9;
            }
          });
        }
        if (state.newStructure === 'broken') {
          this.newCrack.scale.setScalar(1 + strength * 0.08);
        }
        if (state.gate === 'reject') {
          this.gateLight.material.emissiveIntensity = 0.9 + strength * 1.2;
        }
      });
    }

  }

  private fadeGroup(
    group: THREE.Object3D,
    visible: boolean,
    immediate: boolean,
  ): void {
    const target = visible ? 1 : 0;
    const current =
      typeof group.userData.imOpacity === 'number'
        ? (group.userData.imOpacity as number)
        : 0;
    const token = (this.fadeTokens.get(group) ?? 0) + 1;
    this.fadeTokens.set(group, token);
    group.userData.imOpacity = target;
    if (immediate || this.reducedMotion) {
      setGroupOpacity(group, target);
      group.visible = visible;
      return;
    }
    if (Math.abs(current - target) < 0.01) {
      setGroupOpacity(group, target);
      group.visible = visible;
      return;
    }
    group.visible = true;
    this.motion.add(0.52, (progress) => {
      if (this.fadeTokens.get(group) !== token) {
        return;
      }
      const opacity = current + (target - current) * progress;
      group.userData.imOpacity = opacity;
      setGroupOpacity(group, opacity);
      group.visible = opacity > 0.015;
    });
  }

  private updateLabelVisibility(state: PdVisualState): void {
    const setVisible = (nodeId: string, visible: boolean): void => {
      const spec = this.labelSpecs.get(nodeId);
      if (spec) {
        spec.visible = visible;
      }
    };
    if (this.legacy) {
      setVisible('pd.http', true);
      setVisible('pd.pool', true);
      setVisible('pd.legacy_loop', true);
      return;
    }
    setVisible('pd.http', true);
    setVisible('pd.scheduler', true);
    setVisible('pd.pool', true);
    setVisible('pd.guard', state.phase !== 'drain');
    setVisible(
      'pd.idle',
      state.phase === 'busy' ||
        state.phase === 'rejected' ||
        state.phase === 'guard' ||
        state.phase === 'guards-pass' ||
        state.phase === 'invoke-busy',
    );
    setVisible('pd.graph', state.graphGate === 'assumed');
    setVisible('pd.teardown', state.oldStructure === 'present');
    setVisible('pd.prefix', true);
    setVisible('pd.rebuild', state.newStructure !== 'none');
    setVisible('pd.supervisor', state.supervisor === 'active');
    setVisible('pd.health', state.health === 'unhealthy' || state.health === 'busy');
  }

  private refreshEmphasis(): void {
    for (const [id, visual] of this.nodes) {
      const selected = this.selectedNode === id;
      const hovered = this.hoveredNode === id;
      if (visual.ring) {
        visual.ring.material.opacity = selected ? 0.9 : hovered ? 0.55 : 0.16;
      }
      for (const material of visual.edgeMaterials) {
        material.opacity = selected ? 0.86 : hovered ? 0.55 : 0.28;
      }
      const targetScale = selected ? 1.025 : hovered ? 1.01 : 1;
      visual.group.scale.setScalar(targetScale);
    }
  }
}

export function createPdRoleSwitchScene(
  lane: LaneDefinition,
  reducedMotion: boolean,
): SceneHandle {
  return new SglangPdScene(lane, reducedMotion);
}
