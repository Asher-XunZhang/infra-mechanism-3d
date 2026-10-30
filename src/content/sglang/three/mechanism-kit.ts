import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  addEdges,
  lineMaterial,
  standardMaterial,
  tubeAlong,
} from '../../../viewer/three/toolkit';

/** Restrained palette for the continuous mechanism scene. */
export const MECH = {
  ink: 0x071411,
  floor: 0x0b1c19,
  panel: 0x112724,
  panelEdge: 0x2b4a43,
  free: 0x243d38,
  r1: 0x72d3c8,
  r2: 0xecc17c,
  cache: 0xaaa2d8,
  write: 0xa5d6b0,
  reserved: 0xe1ab5a,
  signal: 0xe44c2b,
  mismatch: 0xd96f6b,
  text: 0xf3ecde,
  muted: 0x8d9c97,
} as const;

export type PlateTone =
  | 'neutral'
  | 'r1'
  | 'r2'
  | 'cache'
  | 'write'
  | 'reserved'
  | 'signal'
  | 'muted';

const TONES: Record<
  PlateTone,
  { bg: string; ink: string; border: string; accent: string }
> = {
  neutral: {
    bg: '#efe9da',
    ink: '#15241f',
    border: '#7c8a7c',
    accent: '#44584e',
  },
  r1: {
    bg: '#e4f3ef',
    ink: '#0f2b26',
    border: '#3c9d96',
    accent: '#2c827b',
  },
  r2: {
    bg: '#f6ead0',
    ink: '#2a2110',
    border: '#c28a3c',
    accent: '#a56f23',
  },
  cache: {
    bg: '#efecfa',
    ink: '#221d39',
    border: '#8479ba',
    accent: '#6e63a4',
  },
  write: {
    bg: '#e6f1e5',
    ink: '#17301b',
    border: '#5b9b68',
    accent: '#467d52',
  },
  reserved: {
    bg: '#f8ecd5',
    ink: '#33260e',
    border: '#b98a48',
    accent: '#9b6f30',
  },
  signal: {
    bg: '#f8e3da',
    ink: '#3a140d',
    border: '#c04f2f',
    accent: '#a33b1f',
  },
  muted: {
    bg: '#dfe5da',
    ink: '#28332d',
    border: '#87958a',
    accent: '#67756b',
  },
};

const FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif';

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const output: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw.length) {
      output.push('');
      continue;
    }
    let current = '';
    for (const character of raw) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > maxWidth) {
        output.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    if (current) output.push(current);
  }
  if (output.length <= maxLines) return output;
  const clipped = output.slice(0, maxLines);
  const last = clipped[maxLines - 1] ?? '';
  clipped[maxLines - 1] = `${last.slice(0, Math.max(1, last.length - 1))}…`;
  return clipped;
}

export interface TextPlate {
  sprite: THREE.Sprite;
  set: (text: string, tone?: PlateTone, opacity?: number) => void;
}

export interface TextPlateOptions {
  width: number;
  height: number;
  fontSize?: number;
  canvasWidth?: number;
  align?: 'left' | 'center';
  maxLines?: number;
}

/**
 * A canvas plate used for readable in-scene state. It redraws only when the
 * content changes, so a continuously sampled playback stays cheap.
 */
export function createTextPlate(options: TextPlateOptions): TextPlate {
  const {
    width,
    height,
    fontSize = 34,
    canvasWidth = 512,
    align = 'center',
    maxLines = 4,
  } = options;
  const canvasHeight = Math.max(48, Math.round((canvasWidth * height) / width));
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  let key = '';
  let lastOpacity = 1;

  const set = (text: string, tone: PlateTone = 'neutral', opacity = 1) => {
    const nextKey = `${tone}|${text}`;
    if (nextKey !== key) {
      key = nextKey;
      const style = TONES[tone];
      context.clearRect(0, 0, canvasWidth, canvasHeight);
      const padding = Math.round(Math.min(canvasWidth * 0.035, canvasHeight * 0.12));
      const radius = Math.max(5, Math.min(canvasWidth, canvasHeight) * 0.055);
      context.fillStyle = style.bg;
      roundedRect(
        context,
        padding,
        padding,
        canvasWidth - padding * 2,
        canvasHeight - padding * 2,
        radius,
      );
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = style.border;
      context.stroke();
      context.fillStyle = style.accent;
      context.fillRect(padding, padding, Math.max(4, canvasWidth * 0.012), canvasHeight - padding * 2);
      const readableSize = Math.max(fontSize, Math.min(canvasWidth / 9, (canvasHeight - padding * 2) / (maxLines * 1.28)));
      context.font = `650 ${readableSize}px ${FONT_STACK}`;
      const lines = wrapLines(
        context,
        text,
        canvasWidth - padding * 2 - 28,
        maxLines,
      );
      context.fillStyle = style.ink;
      context.textBaseline = 'middle';
      context.textAlign = align;
      const lineHeight = readableSize * 1.28;
      const total = lines.length * lineHeight;
      const startY = (canvasHeight - total) / 2 + lineHeight / 2;
      const x = align === 'left' ? padding * 2 + 8 : canvasWidth / 2;
      lines.forEach((line, index) => {
        context.fillText(line, x, startY + index * lineHeight);
      });
      texture.needsUpdate = true;
    }
    if (opacity !== lastOpacity) {
      lastOpacity = opacity;
      material.opacity = opacity;
      material.visible = opacity > 0.01;
    }
  };

  set('');
  return { sprite, set };
}

export interface TokenChip {
  group: THREE.Group;
  plate: TextPlate;
  setToken: (token: number | string | null, tone?: PlateTone) => void;
}

export function createTokenChip(width = 0.62, tone: PlateTone = 'r1'): TokenChip {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(width, 0.13, width * 0.72, 3, 0.04),
    standardMaterial(0x233a35, {
      roughness: 0.5,
      metalness: 0.18,
      emissive: 0x000000,
    }),
  );
  base.position.y = 0.07;
  group.add(base);
  const plate = createTextPlate({
    width: width * 1.45,
    height: width * 0.66,
    fontSize: 30,
    canvasWidth: 256,
    maxLines: 1,
  });
  plate.sprite.position.set(0, 0.36, 0);
  plate.sprite.scale.set(width * 1.45, width * 0.66, 1);
  group.add(plate.sprite);
  const setToken = (token: number | string | null, nextTone: PlateTone = tone) => {
    if (token === null) {
      group.visible = false;
      return;
    }
    group.visible = true;
    plate.set(String(token), nextTone);
    base.material.color.setHex(0x233a35);
    base.material.emissive.setHex(
      nextTone === 'r1'
        ? MECH.r1
        : nextTone === 'r2'
          ? MECH.r2
          : nextTone === 'cache'
            ? MECH.cache
            : nextTone === 'write'
              ? MECH.write
              : nextTone === 'signal'
                ? MECH.signal
                : MECH.reserved,
    );
    base.material.emissiveIntensity = 0.22;
  };
  setToken(null);
  return { group, plate, setToken };
}

export interface SlotView {
  id: number;
  token: number | null;
  written: boolean;
  cached: boolean;
  refs: string[];
  pending?: boolean;
  /** The request currently reusing this cached slot, when one exists. */
  reusedBy?: string;
  /** 0 = newly reserved, 1 = written. Used only for the current write animation. */
  write?: number;
}

interface SlotCell {
  view: SlotView | null;
  base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  plate: TextPlate;
  pins: Array<THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>;
  x: number;
  z: number;
}

export interface SlotBoard {
  group: THREE.Group;
  cells: SlotCell[];
  columns: number;
  cellWidth: number;
  cellDepth: number;
  gapX: number;
  gapZ: number;
}

export interface SlotBoardOptions {
  columns?: number;
  cellWidth?: number;
  cellDepth?: number;
  gapX?: number;
  gapZ?: number;
  detail?: boolean;
}

export function createSlotBoard(options: SlotBoardOptions = {}): SlotBoard {
  const {
    columns = 6,
    cellWidth = 1.02,
    cellDepth = 0.78,
    gapX = 1.32,
    gapZ = 1.02,
    detail = false,
  } = options;
  const group = new THREE.Group();
  const cells: SlotCell[] = [];
  const rows = Math.max(1, Math.ceil(12 / columns));
  const geometry = new RoundedBoxGeometry(cellWidth, 0.26, cellDepth, 3, 0.05);
  const ringGeometry = new THREE.RingGeometry(
    cellWidth * 0.54,
    cellWidth * 0.62,
    40,
  );
  for (let id = 0; id < 12; id += 1) {
    const row = Math.floor(id / columns);
    const column = id % columns;
    const x = (column - (columns - 1) / 2) * gapX;
    const z = (row - (rows - 1) / 2) * gapZ;
    const base = new THREE.Mesh(
      geometry.clone(),
      standardMaterial(MECH.free, {
        roughness: 0.55,
        metalness: 0.2,
        transparent: true,
        opacity: 0.5,
      }),
    );
    base.position.set(x, 0.16, z);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(base.geometry, 24),
      lineMaterial(0x557068, 0.38),
    );
    base.add(edges);
    group.add(base);
    const ring = new THREE.Mesh(
      ringGeometry.clone(),
      new THREE.MeshBasicMaterial({
        color: MECH.cache,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.34, z);
    ring.visible = false;
    ring.scale.setScalar(1.35);
    group.add(ring);
    const plate = createTextPlate({
      width: detail ? 1.42 : 1.22,
      height: detail ? 0.84 : 0.56,
      fontSize: detail ? 28 : 27,
      canvasWidth: 384,
      maxLines: detail ? 3 : 2,
    });
    plate.sprite.position.set(x, detail ? 0.55 : 0.92, z);
    group.add(plate.sprite);
    const pins: SlotCell['pins'] = [];
    for (const [index, color] of [MECH.r1, MECH.r2].entries()) {
      const pin = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 10, 8),
        standardMaterial(color, {
          roughness: 0.4,
          metalness: 0.2,
          emissive: color,
          emissiveIntensity: 0.6,
          transparent: true,
          opacity: 0.95,
        }),
      );
      pin.position.set(
        x + (index === 0 ? -cellWidth * 0.3 : cellWidth * 0.3),
        0.4,
        z - cellDepth * 0.3,
      );
      pin.visible = false;
      group.add(pin);
      pins.push(pin);
    }
    cells.push({ view: null, base, ring, plate, pins, x, z });
  }
  return { group, cells, columns, cellWidth, cellDepth, gapX, gapZ };
}

const FREE_LABEL = '空闲';

export function updateSlotBoard(
  board: SlotBoard,
  views: SlotView[],
  options: {
    detail?: boolean;
    refOpacity?: number;
    showRefs?: string[];
    caption?: string;
  } = {},
): void {
  const { refOpacity = 1, showRefs = ['R1', 'R2'] } = options;
  board.cells.forEach((cell, id) => {
    const view = views.find((candidate) => candidate.id === id) ?? null;
    cell.view = view;
    const refs = (view?.refs ?? []).filter((ref) => showRefs.includes(ref));
    const writing = view?.write !== undefined && view.write < 1;
    const warm = view?.pending || (view && !view.written);
    const baseColor = warm
      ? new THREE.Color(MECH.reserved)
      : new THREE.Color(MECH.write);
    if (view?.write !== undefined) {
      baseColor.lerpColors(
        new THREE.Color(MECH.reserved),
        new THREE.Color(MECH.write),
        Math.max(0, Math.min(1, view.write)),
      );
    }
    if (!view) {
      cell.base.material.color.setHex(MECH.free);
      cell.base.material.emissive.setHex(0x000000);
      cell.base.material.emissiveIntensity = 0;
      cell.base.material.opacity = 0.38;
      cell.plate.set(`#${String(id).padStart(2, '0')}\n${FREE_LABEL}`, 'muted', 0.66);
      cell.ring.visible = false;
      cell.ring.material.opacity = 0;
      cell.pins.forEach((pin) => {
        pin.visible = false;
        pin.material.opacity = 0;
      });
      return;
    }
    cell.base.material.color.copy(baseColor);
    cell.base.material.emissive.copy(baseColor);
    cell.base.material.emissiveIntensity = warm ? 0.4 : 0.24;
    cell.base.material.opacity = view.pending ? 0.72 : 0.96;
    const head = `#${String(id).padStart(2, '0')} · ${view.token ?? '—'}`;
    const refsText = refs.length ? refs.join(' ') : '';
    let label: string;
    let tone: PlateTone;
    if (view.pending) {
      label = `${head}\n预留`;
      tone = 'reserved';
    } else if (writing) {
      label = `${head}\n写入中`;
      tone = 'reserved';
    } else if (view.cached && view.reusedBy) {
      label = `${head}\n缓存持有\n引用 ${view.reusedBy}`;
      tone = 'cache';
    } else if (view.cached && refsText) {
      label = `${head}\n缓存 · ${refsText}`;
      tone = 'cache';
    } else if (view.cached) {
      label = `${head}\n缓存持有`;
      tone = 'cache';
    } else if (view.written) {
      label = `${head}\n已写入`;
      tone = 'write';
    } else {
      label = `${head}\n已预留`;
      tone = 'reserved';
    }
    cell.plate.set(label, tone, view.pending ? 0.85 : 1);
    cell.ring.visible = Boolean(view.cached);
    cell.ring.material.opacity = view.cached ? 0.92 : 0;
    cell.pins.forEach((pin, index) => {
      const ref = index === 0 ? 'R1' : 'R2';
      const visible = refs.includes(ref);
      pin.visible = visible;
      pin.material.opacity = visible ? refOpacity : 0;
    });
  });
}

export interface AxisLine {
  line: THREE.Line;
  update: (points: THREE.Vector3[]) => void;
}

export function createDynamicLine(
  color: number,
  opacity: number,
  maxPoints = 12,
): AxisLine {
  const positions = new Float32Array(maxPoints * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  const update = (points: THREE.Vector3[]) => {
    const count = Math.min(maxPoints, points.length);
    for (let index = 0; index < count; index += 1) {
      const point = points[index];
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
    }
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.needsUpdate = true;
    geometry.setDrawRange(0, count);
  };
  return { line, update };
}

export function createRail(
  points: THREE.Vector3[],
  color: number,
  opacity = 0.3,
  radius = 0.022,
): THREE.Mesh {
  return tubeAlong(points, radius, color, opacity, 64);
}

export function createModuleDock(
  width: number,
  depth: number,
  height: number,
  color: number,
  options: { edge?: number; opacity?: number } = {},
): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(width, height, depth, 3, 0.08),
    standardMaterial(MECH.panel, {
      roughness: 0.6,
      metalness: 0.16,
      transparent: true,
      opacity: options.opacity ?? 0.96,
    }),
  );
  mesh.position.y = height / 2;
  addEdges(group, mesh, options.edge ?? color, 0.5);
  const strip = new THREE.Mesh(
    new RoundedBoxGeometry(width * 0.86, 0.05, 0.1, 2, 0.02),
    standardMaterial(color, {
      roughness: 0.4,
      metalness: 0.2,
      emissive: color,
      emissiveIntensity: 0.5,
    }),
  );
  strip.position.set(0, height + 0.02, depth / 2 - 0.18);
  group.add(strip);
  return group;
}

export function makeCurve(points: Array<[number, number, number]>): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.35,
  );
}

export function smooth(t: number): number {
  const value = Math.max(0, Math.min(1, t));
  return value * value * (3 - 2 * value);
}
