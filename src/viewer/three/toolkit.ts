import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const palette = {
  ink: 0x0b171b,
  stage: 0x0d1b1e,
  body: 0x183136,
  bodyLight: 0x22484a,
  line: 0x2b5a58,
  paper: 0xf3ecde,
  muted: 0x8d9c97,
  cyan: 0x72d3c8,
  amber: 0xe1ab5a,
  coral: 0xd96743,
  lilac: 0xaaa2d8,
  mint: 0xa5d6b0,
  rose: 0xd96f6b,
  white: 0xf7f2e7,
};

export function colorFor(accent: string): number {
  return palette[accent as keyof typeof palette] ?? palette.cyan;
}

export function standardMaterial(
  color: number,
  options: {
    roughness?: number;
    metalness?: number;
    emissive?: number;
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    flatShading?: boolean;
  } = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.58,
    metalness: options.metalness ?? 0.22,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    flatShading: options.flatShading ?? false,
  });
}

export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new RoundedBoxGeometry(width, height, depth, 3, Math.min(radius, height / 2, width / 2, depth / 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function addEdges(
  parent: THREE.Object3D,
  source: THREE.Mesh,
  color: number,
  opacity = 0.42,
): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(source.geometry as THREE.BufferGeometry, 28);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  source.add(lines);
  parent.add(source);
  return lines;
}

export function lineMaterial(color: number, opacity = 0.7): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

export function tubeAlong(
  points: THREE.Vector3[],
  radius: number,
  color: number,
  opacity = 0.9,
  tubularSegments = 48,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 6, false);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

export function lineAlong(
  points: THREE.Vector3[],
  color: number,
  opacity = 0.6,
  dashed = false,
): THREE.Line | THREE.LineSegments {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  if (dashed) {
    const material = new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity,
      dashSize: 0.14,
      gapSize: 0.11,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    return line;
  }
  return new THREE.Line(geometry, lineMaterial(color, opacity));
}

export function createGlowTexture(size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('2D canvas unavailable');
  }
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.02,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function glowSprite(
  color: number,
  scale = 1.4,
  opacity = 0.5,
): THREE.Sprite {
  const material = new THREE.SpriteMaterial({
    map: createGlowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

export function markNode<T extends THREE.Object3D>(object: T, nodeId: string): T {
  object.traverse((child) => {
    child.userData.nodeId = nodeId;
  });
  return object;
}

export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const material = mesh.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) {
      material.forEach((item) => materials.add(item));
    } else if (material) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
    material.dispose();
  }
  textures.forEach((texture) => texture.dispose());
}

export function setGroupOpacity(group: THREE.Object3D, opacity: number): void {
  group.visible = opacity > 0.01;
  group.traverse((child) => {
    const material = (child as THREE.Mesh).material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      item.transparent = opacity < 0.999;
      item.opacity = opacity;
      item.depthWrite = opacity >= 0.999;
    }
  });
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface MotionItem {
  elapsed: number;
  duration: number;
  update: (progress: number) => void;
  done?: () => void;
}

export class MotionRunner {
  private items: MotionItem[] = [];

  get active(): boolean {
    return this.items.length > 0;
  }

  add(
    duration: number,
    update: (progress: number) => void,
    done?: () => void,
    easing: (t: number) => number = easeOutCubic,
  ): void {
    if (duration <= 0) {
      update(1);
      done?.();
      return;
    }
    this.items.push({ elapsed: 0, duration, update: (t) => update(easing(t)), done });
  }

  update(delta: number): boolean {
    if (this.items.length === 0) {
      return false;
    }
    const remaining: MotionItem[] = [];
    for (const item of this.items) {
      item.elapsed = Math.min(item.duration, item.elapsed + delta);
      item.update(item.elapsed / item.duration);
      if (item.elapsed >= item.duration) {
        item.done?.();
      } else {
        remaining.push(item);
      }
    }
    this.items = remaining;
    return this.items.length > 0;
  }

  clear(): void {
    this.items = [];
  }
}

export function cellGrid(
  rows: number,
  columns: number,
  cellSize: number,
  gap: number,
  color: number,
  activeColor: number,
): { group: THREE.Group; cells: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] } {
  const group = new THREE.Group();
  const cells: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  const geometry = new THREE.BoxGeometry(cellSize * 0.86, 0.035, cellSize * 0.58);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const material = standardMaterial(color, {
        roughness: 0.5,
        metalness: 0.2,
        emissive: 0x000000,
        transparent: true,
        opacity: 0.55,
      });
      const cell = new THREE.Mesh(geometry, material);
      cell.position.set(
        (column - (columns - 1) / 2) * (cellSize + gap),
        0,
        (row - (rows - 1) / 2) * (cellSize * 0.7 + gap),
      );
      cell.userData.baseColor = color;
      cell.userData.activeColor = activeColor;
      group.add(cell);
      cells.push(cell);
    }
  }
  // This geometry is shared by the cell meshes; dispose it once by reusing the
  // first mesh geometry on all subsequent meshes. The generic disposer handles
  // the duplicate dispose calls safely for Three.js geometries.
  return { group, cells };
}

export function setCellActive(
  cell: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>,
  active: boolean,
): void {
  const color = active
    ? (cell.userData.activeColor as number)
    : (cell.userData.baseColor as number);
  cell.material.color.setHex(color);
  cell.material.emissive.setHex(active ? color : 0x000000);
  cell.material.emissiveIntensity = active ? 1.4 : 0;
  cell.material.opacity = active ? 0.95 : 0.35;
}

export function markerRing(
  radius: number,
  color: number,
  opacity = 0.7,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.RingGeometry(radius * 0.82, radius, 64);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
