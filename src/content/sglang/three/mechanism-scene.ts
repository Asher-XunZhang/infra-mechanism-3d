import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type {
  FocusPoint,
  OverlayLabelSpec,
  SceneHandle,
  ScenePlaybackContext,
  StepRenderContext,
} from '../../../viewer/types';
import {
  addEdges,
  lineMaterial,
  standardMaterial,
  tubeAlong,
} from '../../../viewer/three/toolkit';
import {
  createMechanismTrace,
  type MechanismEvent,
  type MechanismModule,
  type MechanismRequest,
  type MechanismState,
  type MechanismTrace,
  type RequestId,
} from '../mechanism';
import {
  MECH,
  createModuleDock,
  createRail,
  createTextPlate,
  createTokenChip,
  createDynamicLine,
  createSlotBoard,
  makeCurve,
  smooth,
  updateSlotBoard,
  type AxisLine,
  type PlateTone,
  type SlotBoard,
  type SlotView,
  type TextPlate,
  type TokenChip,
} from './mechanism-kit';

const BASE_CACHE = new THREE.Vector3(-2.8, 0.58, -5.15);
const BASE_SCHEDULER = new THREE.Vector3(-2.8, 0.42, 0);
const WAITING = new THREE.Vector3(-4.55, 0.72, 1.45);
const BATCH = new THREE.Vector3(-1.85, 0.82, 0.72);
const RESULT = new THREE.Vector3(-1.85, 0.88, -1.32);
const API = new THREE.Vector3(-12.15, 0, 0);
const TOKENIZER = new THREE.Vector3(-8.75, 0, 0);
const EXECUTION = new THREE.Vector3(3.15, 0, 0.25);
const MODEL = new THREE.Vector3(6.9, 0, 0.25);
const DETOKENIZER = new THREE.Vector3(10.7, 0, 0.1);

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface CardVisual {
  group: THREE.Group;
  plate: TextPlate;
  base: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  set: (text: string, tone: PlateTone) => void;
}

function createCardVisual(
  width = 1.78,
  depth = 0.95,
  tone: PlateTone = 'neutral',
): CardVisual {
  const group = new THREE.Group();
  const accent =
    tone === 'r1'
      ? MECH.r1
      : tone === 'r2'
        ? MECH.r2
        : tone === 'cache'
          ? MECH.cache
          : MECH.signal;
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(width, 0.12, depth, 3, 0.05),
    standardMaterial(0x203630, {
      roughness: 0.44,
      metalness: 0.2,
      emissive: accent,
      emissiveIntensity: 0.16,
    }),
  );
  base.position.y = 0.06;
  group.add(base);
  const plate = createTextPlate({
    width: width * 0.98,
    height: depth * 0.72,
    fontSize: 27,
    canvasWidth: 512,
    align: 'left',
    maxLines: 3,
  });
  plate.sprite.position.set(0, 0.48, 0);
  group.add(plate.sprite);
  return {
    group,
    plate,
    base,
    set(text: string, nextTone: PlateTone = tone) {
      plate.set(text, nextTone);
      base.material.emissive.setHex(
        nextTone === 'r1'
          ? MECH.r1
          : nextTone === 'r2'
            ? MECH.r2
            : nextTone === 'cache'
              ? MECH.cache
              : MECH.write,
      );
    },
  };
}

interface PacketVisual extends CardVisual {
  smallPlate: TextPlate;
}

function createPacketVisual(tone: PlateTone = 'cache'): PacketVisual {
  const group = new THREE.Group();
  const accent =
    tone === 'r1'
      ? MECH.r1
      : tone === 'r2'
        ? MECH.r2
        : tone === 'cache'
          ? MECH.cache
          : MECH.signal;
  const base = new THREE.Mesh(
    new RoundedBoxGeometry(1.16, 0.1, 0.56, 3, 0.04),
    standardMaterial(0x213934, {
      roughness: 0.36,
      metalness: 0.22,
      emissive: accent,
      emissiveIntensity: 0.32,
    }),
  );
  base.position.y = 0.05;
  group.add(base);
  const plate = createTextPlate({
    width: 1.12,
    height: 0.42,
    fontSize: 21,
    canvasWidth: 384,
    align: 'left',
    maxLines: 2,
  });
  plate.sprite.position.set(0, 0.36, 0);
  group.add(plate.sprite);
  const smallPlate = createTextPlate({
    width: 1.3,
    height: 0.3,
    fontSize: 18,
    canvasWidth: 384,
    align: 'center',
    maxLines: 1,
  });
  smallPlate.sprite.position.set(0, 0.08, 0.34);
  group.add(smallPlate.sprite);
  return {
    group,
    plate,
    smallPlate,
    base,
    set(text: string, nextTone: PlateTone = tone) {
      plate.set(text, nextTone);
      base.material.emissive.setHex(
        nextTone === 'r1'
          ? MECH.r1
          : nextTone === 'r2'
            ? MECH.r2
            : nextTone === 'cache'
              ? MECH.cache
              : MECH.write,
      );
    },
  };
}

function createArrow(point: THREE.Vector3, direction: THREE.Vector3, color: number): THREE.Mesh {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.085, 0.24, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  );
  cone.position.copy(point);
  cone.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );
  return cone;
}

function addDirectionalRail(
  scene: THREE.Scene,
  points: THREE.Vector3[],
  color: number,
  opacity: number,
  radius = 0.022,
): void {
  const curve = makeCurve(points.map((point) => [point.x, point.y, point.z]));
  scene.add(createRail(curve.getPoints(48), color, opacity, radius));
  for (const t of [0.38, 0.72]) {
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    scene.add(createArrow(point, tangent, color));
  }
}

function requestTone(id: RequestId): PlateTone {
  return id === 'R1' ? 'r1' : 'r2';
}

function batchText(mode: MechanismState['batch']['mode']): string {
  return mode === 'idle' ? '空闲' : mode === 'prefill' ? '预填充' : '逐 token 解码';
}

function outputText(request: MechanismRequest): string {
  return request.outputTokens.length
    ? request.outputTokens.join(' ')
    : '…';
}

function phaseText(event: MechanismEvent, request: MechanismRequest): string {
  if (event.id.endsWith('.arrive')) return '进入入口';
  if (event.id.endsWith('.queue')) return '等待调度';
  if (event.id.endsWith('.match')) {
    return request.matchedPrefix
      ? `复用 ${request.matchedPrefix} 个位置`
      : '比较前缀';
  }
  if (event.id.endsWith('.allocate')) return '进入批次';
  if (event.id.endsWith('.prefill')) return '预填充中';
  if (event.id.endsWith('.prefill-result')) return '处理第一个输出';
  if (event.id.endsWith('decode-1-prepare') || event.id.endsWith('decode-2-prepare')) {
    return '上一输出转为输入';
  }
  if (event.kind === 'decode') return '解码前向';
  if (event.kind === 'result') return '追加输出';
  if (event.id.endsWith('.release')) return '释放请求引用';
  if (event.id.endsWith('.output')) return '回告文本';
  return '已完成';
}

/**
 * A continuous teaching scene for the fixed SGLang trace. Semantic quantities
 * (queue occupancy, cache ownership, outputs) always come from sample.state;
 * only in-flight objects and write interpolation use event progress.
 */
export class MechanismScene implements SceneHandle {
  readonly scene = new THREE.Scene();
  readonly labels: OverlayLabelSpec[] = [];
  readonly focus: Record<string, FocusPoint> = {};
  readonly home: FocusPoint = {
    target: vec(-1.7, 1.35, -1.15),
    position: vec(13.4, 10.2, 17.6),
  };

  private readonly trace: MechanismTrace;
  private readonly sharedPrefix: boolean;
  private readonly reducedMotion: boolean;
  private readonly traceStarts: number[] = [];
  private readonly moduleNodes = new Map<
    MechanismModule,
    { group: THREE.Group; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; accent: number }
  >();
  private readonly requestCards = new Map<RequestId, CardVisual>();
  private readonly cardPlateKey = new Map<string, string>();
  private readonly rails = new Map<string, THREE.Mesh[]>();
  private readonly requestRoute: THREE.CatmullRomCurve3;
  private readonly queueRoute: THREE.CatmullRomCurve3;
  private readonly allocateRoute: THREE.CatmullRomCurve3;
  private readonly outboundRoute: THREE.CatmullRomCurve3;
  private readonly returnRoute: THREE.CatmullRomCurve3;
  private readonly releaseRoute: THREE.CatmullRomCurve3;
  private readonly outputRoute: THREE.CatmullRomCurve3;
  private readonly textRoute: THREE.CatmullRomCurve3;
  private readonly matchRoute: THREE.CatmullRomCurve3;
  private readonly loopRoute: THREE.CatmullRomCurve3;

  private readonly prefixProbe = createPacketVisual('cache');
  private readonly forwardPacket = createPacketVisual('r1');
  private readonly returnPacket = createPacketVisual('write');
  private readonly resultToken = createPacketVisual('write');
  private readonly nextInputToken = createPacketVisual('r1');
  private readonly textPacket = createPacketVisual('neutral');

  private waitingDeck!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private batchDeck!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private resultDeck!: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private waitingPlate!: TextPlate;
  private batchPlate!: TextPlate;
  private batchModePlate!: TextPlate;
  private loopPlate!: TextPlate;
  private cacheBoard!: SlotBoard;
  private readonly cachePathRows: Array<{
    label: TextPlate;
    chips: TokenChip[];
  }> = [];
  private readonly compareGroup = new THREE.Group();
  private readonly compareInputs: TokenChip[] = [];
  private readonly compareCached: TokenChip[] = [];
  private readonly compareStatus: TextPlate[] = [];
  private compareHead!: TextPlate;
  private compareSubhead!: TextPlate;
  private compareSourceLabel!: TextPlate;
  private compareCacheLabel!: TextPlate;
  private readonly compareBeams: AxisLine[] = [];
  private readonly compareAnchors: Array<{ input: THREE.Vector3; cached: THREE.Vector3 }> = [];
  private readonly cacheDetail = new THREE.Group();
  private readonly detailLayers: Array<{ object: THREE.Object3D; wrapper: THREE.Group }> = [];
  private cacheHint!: TextPlate;
  private cacheLegend!: TextPlate;
  private readonly executionDetail = new THREE.Group();
  private executionHint!: TextPlate;
  private lastOutputHint!: TextPlate;
  private readonly executionTokenChips: TokenChip[] = [];
  private readonly executionGates: Array<{ plate: TextPlate; ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; slot: TextPlate }> = [];
  private executionLoop!: TextPlate;
  private executionInputLabel!: TextPlate;
  private schedulerTitle!: TextPlate;
  private modelTitle!: TextPlate;
  private readonly moduleAnchors = new Map<MechanismModule, THREE.Vector3>();

  private activeModules = new Set<MechanismModule>();
  private selected: string | null = null;
  private hovered: string | null = null;
  private currentTime = 0;

  constructor(options: {
    sharedPrefix?: boolean;
    reducedMotion?: boolean;
  } = {}) {
    this.sharedPrefix = options.sharedPrefix !== false;
    this.reducedMotion = Boolean(options.reducedMotion);
    this.trace = createMechanismTrace({ sharedPrefix: this.sharedPrefix });
    let cursor = 0;
    for (const event of this.trace.events) {
      this.traceStarts.push(cursor);
      cursor += event.duration;
    }

    this.requestRoute = makeCurve([
      [API.x + 1.0, 0.76, 0],
      [-10.5, 0.9, 0.22],
      [TOKENIZER.x, 0.82, 0],
    ]);
    this.queueRoute = makeCurve([
      [TOKENIZER.x, 0.82, 0],
      [-7.1, 0.96, 0.45],
      [-5.3, 0.92, 1.2],
      [WAITING.x, WAITING.y, WAITING.z],
    ]);
    this.allocateRoute = makeCurve([
      [WAITING.x, WAITING.y, WAITING.z],
      [-3.3, 1.16, 1.3],
      [BATCH.x, BATCH.y, BATCH.z],
    ]);
    this.outboundRoute = makeCurve([
      [BATCH.x + 0.4, BATCH.y + 0.12, BATCH.z],
      [0.4, 1.05, 0.55],
      [EXECUTION.x - 1.2, 1.02, 0.5],
      [EXECUTION.x + 0.4, 1.25, 0.35],
      [MODEL.x - 0.9, 1.35, 0.3],
    ]);
    this.returnRoute = makeCurve([
      [MODEL.x - 0.7, 1.38, 0.2],
      [8.5, 2.05, -1.25],
      [4.4, 2.2, -1.9],
      [0.9, 1.72, -1.55],
      [RESULT.x, RESULT.y, RESULT.z],
    ]);
    this.releaseRoute = makeCurve([
      [BATCH.x, BATCH.y, BATCH.z],
      [-2.4, 1.05, 0.5],
      [RESULT.x, RESULT.y, RESULT.z],
    ]);
    this.outputRoute = makeCurve([
      [RESULT.x, RESULT.y + 0.2, RESULT.z],
      [1.6, 2.05, -0.9],
      [5.8, 2.2, -0.4],
      [8.8, 1.9, 0.15],
      [DETOKENIZER.x - 0.8, 1.2, 0.1],
    ]);
    this.textRoute = makeCurve([
      [DETOKENIZER.x - 0.35, 1.4, 0.1],
      [12.4, 3.0, 2.7],
      [5.2, 4.0, 3.3],
      [-5.2, 4.0, 3.2],
      [API.x + 0.3, 1.1, 0.2],
    ]);
    this.matchRoute = makeCurve([
      [WAITING.x, WAITING.y, WAITING.z],
      [-4.15, 1.15, 0.4],
      [-3.7, 1.15, -1.5],
      [-3.15, 1.15, -3.45],
      [BASE_CACHE.x + 3.05, 1.2, BASE_CACHE.z + 2.18],
    ]);
    this.loopRoute = makeCurve([
      [RESULT.x + 0.2, RESULT.y, RESULT.z],
      [-0.3, 1.2, -1.05],
      [-0.45, 1.24, 0.95],
      [BATCH.x + 0.4, BATCH.y, BATCH.z],
    ]);

    this.buildGround();
    this.buildModuleBodies();
    this.buildScheduler();
    this.buildExecution();
    this.buildCache();
    this.buildRails();
    this.buildRequestCards();
    this.buildPackets();
    this.buildLabels();
    this.buildFocus();

    this.scene.add(
      this.prefixProbe.group,
      this.forwardPacket.group,
      this.returnPacket.group,
      this.resultToken.group,
      this.nextInputToken.group,
      this.textPacket.group,
    );
    for (const visual of [
      this.prefixProbe,
      this.forwardPacket,
      this.returnPacket,
      this.resultToken,
      this.nextInputToken,
      this.textPacket,
    ]) {
      visual.group.visible = false;
    }
    // The slot board and comparison already carry token → #slot; suppress the
    // older floating path rows and long mapping beams in this compact drilldown.
    const suppressedDetail = new THREE.Group();
    suppressedDetail.visible = false;
    this.scene.add(suppressedDetail);
    for (const row of this.cachePathRows) {
      suppressedDetail.add(row.label.sprite);
      for (const chip of row.chips) suppressedDetail.add(chip.group);
    }
    for (const beam of this.compareBeams) suppressedDetail.add(beam.line);
    // Visibility of a drilldown is independent of event-owned visibility. Keep
    // every object in the scene for resource disposal and deterministic replay.
    for (const object of [...this.scene.children]) {
      const wrapper = new THREE.Group();
      wrapper.add(object);
      this.scene.add(wrapper);
      this.detailLayers.push({ object, wrapper });
    }
    this.applyTime(0);
  }

  setStep(context: StepRenderContext): void {
    const start = this.traceStarts[context.stepIndex] ?? 0;
    const event = this.trace.events[context.stepIndex];
    this.applyTime(event ? start + event.duration : 0);
  }

  /** One deterministic sample of reading time; no incremental animation state. */
  setPlayback(context: ScenePlaybackContext): void {
    this.applyTime(context.time);
  }

  setSelected(nodeId: string | null): void {
    this.selected = nodeId;
    this.cacheDetail.visible = nodeId === 'cache';
    this.executionDetail.visible = nodeId === 'execution';
    this.refreshModuleState();
  }

  setHovered(nodeId: string | null): void {
    this.hovered = nodeId;
    this.refreshModuleState();
  }

  update(_deltaSeconds: number): boolean {
    return false;
  }

  dispose(): void {
    // StageView owns traversal and material disposal for the scene graph.
  }

  private applyTime(time: number): void {
    this.currentTime = Math.max(0, Math.min(this.traceDuration, time));
    const sample = this.sampleAt(this.currentTime);
    const event = sample.event;
    const progress = this.reducedMotion ? (sample.progress < 1 ? 0 : 1) : sample.progress;
    const state = sample.state;
    const eased = this.reducedMotion ? (progress < 1 ? 0 : 1) : smooth(progress);

    this.activeModules = new Set(event.moduleIds);
    this.updateRequests(event, progress, eased, state, sample.index);
    this.updateScheduler(event, progress, state);
    this.updateCache(event, progress, eased, state);
    this.updateExecution(event, progress, state);
    this.updatePackets(event, progress, state);
    this.updateCacheCompare(event, progress, state);
    this.refreshModuleState();
  }

  private sampleAt(time: number) {
    let index = 0;
    while (
      index < this.trace.events.length - 1 &&
      time >= this.traceStarts[index] + this.trace.events[index].duration
    ) {
      index++;
    }
    const start = this.traceStarts[index] ?? 0;
    const event = this.trace.events[index];
    const progress = Math.max(
      0,
      Math.min(1, (time - start) / Math.max(0.001, event.duration)),
    );
    return {
      index,
      start,
      event,
      progress,
      state: progress < 1 ? event.before : event.after,
    };
  }

  private get traceDuration(): number {
    const last = this.trace.events.at(-1);
    return last
      ? (this.traceStarts.at(-1) ?? 0) + last.duration
      : 0;
  }

  // ------------------------------------------------------------------ ground

  private buildGround(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 18),
      standardMaterial(MECH.floor, {
        roughness: 0.9,
        metalness: 0.08,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(-1.3, -0.02, 0.2);
    this.scene.add(floor);
    const grid = new THREE.GridHelper(30, 30, 0x27423b, 0x18302b);
    grid.position.set(-1.3, 0.005, 0.2);
    const gridMaterial = Array.isArray(grid.material) ? grid.material[0] : grid.material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.35;
    this.scene.add(grid);

    const deviceZone = new THREE.Mesh(
      new THREE.PlaneGeometry(18.8, 8.7),
      new THREE.MeshBasicMaterial({
        color: 0x163630,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    deviceZone.rotation.x = -Math.PI / 2;
    deviceZone.position.set(1.3, 0.008, -1.45);
    this.scene.add(deviceZone);
    const zone = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(18.8, 8.7)),
      lineMaterial(MECH.cache, 0.28),
    );
    zone.rotation.x = -Math.PI / 2;
    zone.position.set(1.3, 0.012, -1.45);
    this.scene.add(zone);
    const zonePlate = createTextPlate({
      width: 4.8,
      height: 0.3,
      fontSize: 18,
      canvasWidth: 768,
      maxLines: 1,
    });
    zonePlate.set('调度进程 / 设备侧：请求引用与 K/V 数据分开', 'muted');
    zonePlate.sprite.position.set(5.1, 0.08, -5.1);
    this.scene.add(zonePlate.sprite);
  }

  // ------------------------------------------------------------------ modules

  private buildModuleBodies(): void {
    const definitions: Array<{
      id: MechanismModule;
      position: THREE.Vector3;
      width: number;
      depth: number;
      height: number;
      color: number;
      label: string;
      meta: string;
      anchorY: number;
    }> = [
      {
        id: 'api',
        position: API,
        width: 2.0,
        depth: 1.75,
        height: 0.72,
        color: MECH.r1,
        label: 'API 入口',
        meta: '文本请求 / 回告',
        anchorY: 1.45,
      },
      {
        id: 'tokenizer',
        position: TOKENIZER,
        width: 2.15,
        depth: 1.75,
        height: 0.82,
        color: MECH.r1,
        label: 'Tokenizer',
        meta: 'token ID + rid',
        anchorY: 1.55,
      },
      {
        id: 'scheduler',
        position: BASE_SCHEDULER.clone().setY(0),
        width: 5.9,
        depth: 4.3,
        height: 0.64,
        color: MECH.r2,
        label: 'Scheduler',
        meta: '等待 → 批次 → 结果',
        anchorY: 2.08,
      },
      {
        id: 'cache',
        position: BASE_CACHE.clone().setY(0),
        width: 7.65,
        depth: 3.25,
        height: 0.48,
        color: MECH.cache,
        label: 'RadixCache / KV 池',
        meta: '索引复用 · 12 个物理槽',
        anchorY: 3.55,
      },
      {
        id: 'execution',
        position: EXECUTION,
        width: 3.75,
        depth: 2.7,
        height: 0.82,
        color: MECH.signal,
        label: 'Worker / Runner',
        meta: '输入 / 引用 → 输出',
        anchorY: 1.8,
      },
      {
        id: 'model',
        position: MODEL,
        width: 2.5,
        depth: 2.4,
        height: 1.18,
        color: MECH.write,
        label: 'Model',
        meta: 'Attention → sample',
        anchorY: 2.0,
      },
      {
        id: 'detokenizer',
        position: DETOKENIZER,
        width: 2.3,
        depth: 1.8,
        height: 0.78,
        color: MECH.r2,
        label: 'Detokenizer',
        meta: 'token → 文本',
        anchorY: 1.55,
      },
    ];
    for (const definition of definitions) {
      const group = new THREE.Group();
      group.position.copy(definition.position);
      group.userData.nodeId = definition.id;
      const dock = createModuleDock(
        definition.width,
        definition.depth,
        definition.height,
        definition.color,
      );
      group.add(dock);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(
          Math.max(definition.width, definition.depth) * 0.42,
          Math.max(definition.width, definition.depth) * 0.48,
          64,
        ),
        new THREE.MeshBasicMaterial({
          color: definition.color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      group.add(ring);
      this.scene.add(group);
      this.moduleNodes.set(definition.id, {
        group,
        ring,
        accent: definition.color,
      });
      this.moduleAnchors.set(
        definition.id,
        definition.position.clone().add(new THREE.Vector3(0, definition.anchorY, 0)),
      );
      this.focus[definition.id] = this.focusFor(definition.id, definition.position);
      if (definition.id === 'api') {
        this.addEntryFrames(group);
      }
      if (definition.id === 'model') {
        this.addModelStack(group, definition.height);
      }
    }
    this.labels.push(
      ...definitions.map((definition) => ({
        id: `${definition.id}-label`,
        text: definition.label,
        meta: definition.meta,
        nodeId: definition.id,
        anchor: () =>
          this.moduleAnchors.get(definition.id) ??
          definition.position.clone().add(new THREE.Vector3(0, definition.anchorY, 0)),
      })),
    );
  }

  private addEntryFrames(group: THREE.Group): void {
    const frame = new THREE.Mesh(
      new RoundedBoxGeometry(1.2, 0.8, 0.1, 2, 0.03),
      standardMaterial(0x1a2e28, {
        roughness: 0.5,
        metalness: 0.2,
        emissive: MECH.r1,
        emissiveIntensity: 0.18,
      }),
    );
    frame.position.set(0, 0.76, 0.84);
    group.add(frame);
    for (let index = 0; index < 3; index++) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.68, 0.035, 0.02),
        new THREE.MeshBasicMaterial({ color: MECH.r1, transparent: true, opacity: 0.7 }),
      );
      line.position.set(0, 0.92 - index * 0.15, 0.9);
      group.add(line);
    }
  }

  private addModelStack(group: THREE.Group, height: number): void {
    for (let index = 0; index < 3; index++) {
      const layer = new THREE.Mesh(
        new RoundedBoxGeometry(1.65, 0.12, 1.5, 2, 0.035),
        standardMaterial(0x173d33, {
          roughness: 0.42,
          metalness: 0.25,
          emissive: MECH.write,
          emissiveIntensity: 0.18 + index * 0.05,
        }),
      );
      layer.position.set(0, height + 0.2 + index * 0.24, 0);
      group.add(layer);
    }
    this.modelTitle = createTextPlate({
      width: 1.9,
      height: 0.36,
      fontSize: 19,
      canvasWidth: 512,
      maxLines: 1,
    });
    this.modelTitle.set('ForwardBatch → sample', 'write');
    this.modelTitle.sprite.position.set(0, height + 1.07, 0);
    group.add(this.modelTitle.sprite);
  }

  private focusFor(id: MechanismModule, position: THREE.Vector3): FocusPoint {
    switch (id) {
      case 'cache':
        return {
          target: position.clone().add(new THREE.Vector3(0, 1.6, 1.9)),
          position: position.clone().add(new THREE.Vector3(0, 8.0, 8.9)),
        };
      case 'scheduler':
        return {
          target: position.clone().add(new THREE.Vector3(0.1, 1.0, 0.2)),
          position: position.clone().add(new THREE.Vector3(4.4, 7.6, 9.3)),
        };
      case 'execution':
        return {
          target: position.clone().add(new THREE.Vector3(0.3, 1.15, 0.6)),
          position: position.clone().add(new THREE.Vector3(0.3, 5.2, 7.2)),
        };
      case 'model':
        return {
          target: position.clone().add(new THREE.Vector3(0, 1.1, 0)),
          position: position.clone().add(new THREE.Vector3(0.6, 6.0, 7.7)),
        };
      case 'detokenizer':
        return {
          target: position.clone().add(new THREE.Vector3(0, 0.9, 0)),
          position: position.clone().add(new THREE.Vector3(-3.8, 5.8, 7.9)),
        };
      case 'api':
        return {
          target: position.clone().add(new THREE.Vector3(0, 0.8, 0)),
          position: position.clone().add(new THREE.Vector3(3.3, 5.1, 7.0)),
        };
      default:
        return {
          target: position.clone().add(new THREE.Vector3(0, 0.9, 0)),
          position: position.clone().add(new THREE.Vector3(3.2, 5.5, 7.1)),
        };
    }
  }

  private buildFocus(): void {
    this.focus.home = this.home;
  }

  // ------------------------------------------------------------------ layout

  private buildScheduler(): void {
    const waiting = new THREE.Mesh(
      new RoundedBoxGeometry(2.15, 0.16, 1.32, 3, 0.06),
      standardMaterial(0x1b3831, {
        roughness: 0.55,
        metalness: 0.16,
        emissive: MECH.r2,
        emissiveIntensity: 0.16,
      }),
    );
    waiting.position.copy(WAITING).setY(0.56);
    addEdges(this.scene, waiting, MECH.r2, 0.35);
    this.waitingDeck = waiting as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const batch = new THREE.Mesh(
      new RoundedBoxGeometry(2.45, 0.2, 1.55, 3, 0.06),
      standardMaterial(0x1b3b32, {
        roughness: 0.46,
        metalness: 0.2,
        emissive: MECH.write,
        emissiveIntensity: 0.2,
      }),
    );
    batch.position.copy(BATCH).setY(0.58);
    addEdges(this.scene, batch, MECH.write, 0.4);
    this.batchDeck = batch as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const result = new THREE.Mesh(
      new RoundedBoxGeometry(2.1, 0.17, 1.16, 3, 0.05),
      standardMaterial(0x1b3831, {
        roughness: 0.52,
        metalness: 0.18,
        emissive: MECH.cache,
        emissiveIntensity: 0.16,
      }),
    );
    result.position.copy(RESULT).setY(0.53);
    addEdges(this.scene, result, MECH.cache, 0.36);
    this.resultDeck = result as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

    this.waitingPlate = createTextPlate({
      width: 1.75,
      height: 0.34,
      fontSize: 18,
      canvasWidth: 512,
      maxLines: 1,
    });
    this.waitingPlate.set('等待队列', 'r2');
    this.waitingPlate.sprite.position.copy(WAITING).add(new THREE.Vector3(0, 0.98, 0));
    this.scene.add(this.waitingPlate.sprite);

    this.batchPlate = createTextPlate({
      width: 2.0,
      height: 0.38,
      fontSize: 20,
      canvasWidth: 512,
      maxLines: 1,
    });
    this.batchPlate.set('批次 / 运行位置', 'write');
    this.batchPlate.sprite.position.copy(BATCH).add(new THREE.Vector3(0, 1.44, 0));
    this.scene.add(this.batchPlate.sprite);

    this.batchModePlate = createTextPlate({
      width: 1.45,
      height: 0.32,
      fontSize: 17,
      canvasWidth: 384,
      maxLines: 1,
    });
    this.batchModePlate.set('批次：空闲', 'muted');
    this.batchModePlate.sprite.position.copy(RESULT).add(new THREE.Vector3(0, 0.94, 0));
    this.batchModePlate.sprite.visible = false;
    this.scene.add(this.batchModePlate.sprite);

    const resultPlate = createTextPlate({
      width: 1.5,
      height: 0.32,
      fontSize: 17,
      canvasWidth: 384,
      maxLines: 1,
    });
    resultPlate.set('结果 / 输出暂存', 'cache');
    resultPlate.sprite.position.copy(RESULT).add(new THREE.Vector3(0, 0.98, 0));
    this.scene.add(resultPlate.sprite);

    this.schedulerTitle = createTextPlate({
      width: 2.45,
      height: 0.34,
      fontSize: 18,
      canvasWidth: 512,
      maxLines: 1,
    });
    this.schedulerTitle.set('同一请求身份停在这里', 'neutral');
    this.schedulerTitle.sprite.position.copy(BASE_SCHEDULER).add(new THREE.Vector3(-1.65, 2.2, -0.9));
    this.schedulerTitle.sprite.visible = false;
    this.scene.add(this.schedulerTitle.sprite);

    this.loopPlate = createTextPlate({
      width: 1.15,
      height: 0.32,
      fontSize: 16,
      canvasWidth: 320,
      maxLines: 1,
    });
    this.loopPlate.set('再次解码', 'muted');
    this.loopPlate.sprite.position.set(-0.05, 1.45, -0.05);
    this.loopPlate.sprite.visible = false;
    this.scene.add(this.loopPlate.sprite);
  }

  private buildExecution(): void {
    for (let index = 0; index < 2; index++) {
      const bay = new THREE.Mesh(
        new RoundedBoxGeometry(0.92, 0.26, 0.72, 2, 0.04),
        standardMaterial(0x482a22, {
          roughness: 0.52,
          metalness: 0.18,
          emissive: MECH.signal,
          emissiveIntensity: 0.16,
        }),
      );
      bay.position.set(EXECUTION.x - 0.6 + index * 1.2, 0.96, EXECUTION.z - 0.2);
      addEdges(this.scene, bay, MECH.signal, 0.3);
    }
    this.executionHint = createTextPlate({
      width: 2.2,
      height: 0.34,
      fontSize: 17,
      canvasWidth: 512,
      maxLines: 1,
    });
    this.executionHint.set('点击下钻：上一输出 → 本轮输入', 'signal');
    this.executionHint.sprite.position.set(EXECUTION.x, 2.15, EXECUTION.z + 0.1);
    this.scene.add(this.executionHint.sprite);

    this.executionDetail.visible = false;
    this.scene.add(this.executionDetail);

    const detailPlate = createTextPlate({
      width: 5.3,
      height: 0.38,
      fontSize: 18,
      canvasWidth: 768,
      maxLines: 1,
    });
    detailPlate.set('两次迭代：上一轮输出成为下一轮输入', 'signal');
    detailPlate.sprite.position.set(3.55, 2.62, 1.76);
    this.executionDetail.add(detailPlate.sprite);

    const source = createTextPlate({
      width: 2.4,
      height: 0.34,
      fontSize: 16,
      canvasWidth: 512,
      maxLines: 1,
    });
    source.set('Prefill 首个输出', 'write');
    source.sprite.position.set(1.35, 0.35, 1.85);
    this.executionDetail.add(source.sprite);
    this.lastOutputHint = createTextPlate({ width: 1.8, height: 0.55, fontSize: 28, canvasWidth: 384, maxLines: 2 });
    this.lastOutputHint.sprite.position.set(5.1, 0.35, 1.85);
    this.executionDetail.add(this.lastOutputHint.sprite);

    this.executionInputLabel = createTextPlate({
      width: 2.9,
      height: 0.34,
      fontSize: 16,
      canvasWidth: 640,
      maxLines: 1,
    });
    this.executionInputLabel.set('轮次间的输入关系', 'neutral');
    this.executionInputLabel.sprite.visible = false;
    this.executionInputLabel.sprite.position.set(3.55, 0.78, 2.55);
    this.executionDetail.add(this.executionInputLabel.sprite);

    const chain = new THREE.Group();
    chain.userData.nodeId = 'execution';
    this.executionDetail.add(chain);
    const xs = [1.35, 3.15, 4.95];
    for (const [index, x] of xs.entries()) {
      const chip = createTokenChip(0.72, index === 0 ? 'write' : 'signal');
      chip.group.position.set(x, 1.12, 1.72);
      chain.add(chip.group);
      this.executionTokenChips.push(chip);
    }
    const gateXs = [2.25, 4.05];
    for (const [index, x] of gateXs.entries()) {
      const group = new THREE.Group();
      group.position.set(x, 1.1, 1.72);
      const block = new THREE.Mesh(
        new RoundedBoxGeometry(0.68, 0.64, 0.6, 3, 0.06),
        standardMaterial(0x24342e, {
          roughness: 0.42,
          metalness: 0.24,
          emissive: MECH.signal,
          emissiveIntensity: 0.22,
        }),
      );
      block.position.y = 0.15;
      group.add(block);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.43, 0.018, 8, 32),
        new THREE.MeshBasicMaterial({
          color: MECH.signal,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.48;
      group.add(ring);
      const plate = createTextPlate({
        width: 1.5,
        height: 0.7,
        fontSize: 32,
        canvasWidth: 384,
        maxLines: 2,
      });
      plate.set(`forward ${index + 1}`, 'signal');
      plate.sprite.position.set(0, 0.74, 0);
      group.add(plate.sprite);
      const slot = createTextPlate({
        width: 1.5,
        height: 0.55,
        fontSize: 28,
        canvasWidth: 384,
        maxLines: 1,
      });
      slot.set('写 KV 待定', 'muted');
      slot.sprite.position.set(0, -0.55, 0);
      group.add(slot.sprite);
      this.executionDetail.add(group);
      this.executionGates.push({ plate, ring, slot });
    }
    this.executionTokenChips.forEach((chip, index) => {
      if (index < 2) {
        void chip;
        const x1 = xs[index];
        const x2 = xs[index + 1];
        const curve = makeCurve([
          [x1, 1.2, 1.85],
          [x1 + 0.4, 1.38, 2.1],
          [x2 - 0.35, 1.38, 2.1],
          [x2, 1.2, 1.85],
        ]);
        const line = createRail(curve.getPoints(30), MECH.signal, 0.48, 0.015);
        this.executionDetail.add(line);
        this.executionDetail.add(
          createArrow(
            curve.getPointAt(0.72),
            curve.getTangentAt(0.72),
            MECH.signal,
          ),
        );
      }
    });
    const loopText = createTextPlate({
      width: 2.55,
      height: 0.48,
      fontSize: 16,
      canvasWidth: 640,
      maxLines: 2,
    });
    loopText.set('输出 102 被接着喂回\n作为第 2 次 forward 的输入', 'signal');
    loopText.sprite.position.set(3.35, 0.5, 2.62);
    this.executionDetail.add(loopText.sprite);
    this.executionLoop = loopText;
  }

  private buildCache(): void {
    const cacheNode = this.moduleNodes.get('cache')?.group;
    if (!cacheNode) return;
    this.cacheBoard = createSlotBoard({
      columns: 4,
      cellWidth: 1.12,
      cellDepth: 0.82,
      gapX: 1.7,
      gapZ: 1.32,
      detail: true,
    });
    this.cacheBoard.group.position.set(0, 0.62, -0.2);
    cacheNode.add(this.cacheBoard.group);

    this.cacheHint = createTextPlate({
      width: 4.6,
      height: 0.5,
      fontSize: 16,
      canvasWidth: 768,
      maxLines: 2,
    });
    this.cacheHint.set(
      this.sharedPrefix
        ? '共享前缀条件：R2 复用 R1 的前两个位置\n点选本模块，逐 token 下钻'
        : '不共享前缀：R2 从第一个 token 就不同\n点选本模块，逐 token 下钻',
      'cache',
    );
    this.cacheHint.sprite.position.set(0, 3.62, 1.62);
    this.cacheHint.sprite.visible = false;
    cacheNode.add(this.cacheHint.sprite);

    this.cacheDetail.visible = false;
    cacheNode.add(this.cacheDetail);

    this.cacheLegend = createTextPlate({
      width: 2.45,
      height: 0.54,
      fontSize: 15,
      canvasWidth: 512,
      maxLines: 2,
    });
    this.cacheLegend.set('缓存持有 + 请求引用\n同槽位的两个生命周期', 'cache');
    this.cacheLegend.sprite.position.set(-3.15, 2.34, 2.72);
    this.cacheLegend.sprite.visible = false;
    this.cacheDetail.add(this.cacheLegend.sprite);

    // The cache path is a logical list of indices; physical tokens stay in the
    // slot board below and are never duplicated into this row.
    for (let row = 0; row < 3; row++) {
      const label = createTextPlate({
        width: 1.4,
        height: 0.52,
        fontSize: 15,
        canvasWidth: 384,
        align: 'left',
        maxLines: 2,
      });
      label.set('', 'muted', 0);
      label.sprite.visible = false;
      label.sprite.position.set(-3.55, 3.0 + row * 0.34, -0.35);
      this.cacheDetail.add(label.sprite);
      const chips: TokenChip[] = [];
      for (let index = 0; index < 6; index++) {
        const chip = createTokenChip(0.5, 'cache');
        chip.group.position.set(-2.58 + index * 0.63, 3.0 + row * 0.34, -0.35);
        this.cacheDetail.add(chip.group);
        chips.push(chip);
      }
      this.cachePathRows.push({ label, chips });
    }

    this.compareGroup.position.set(0, 0, 4.05);
    this.cacheDetail.add(this.compareGroup);
    const panel = new THREE.Mesh(
      new RoundedBoxGeometry(7.55, 0.08, 2.55, 3, 0.06),
      standardMaterial(0x162823, {
        roughness: 0.65,
        metalness: 0.12,
        transparent: true,
        opacity: 0.88,
      }),
    );
    panel.position.y = 0.02;
    addEdges(this.compareGroup, panel, MECH.cache, 0.26);

    this.compareHead = createTextPlate({
      width: 6.8,
      height: 0.6,
      fontSize: 28,
      canvasWidth: 640,
      maxLines: 1,
    });
    this.compareHead.set('R2 输入逐项对照已有缓存', 'cache');
    this.compareHead.sprite.position.set(0, 3.2, 0.12);
    this.compareGroup.add(this.compareHead.sprite);
    this.compareSubhead = createTextPlate({
      width: 6.8,
      height: 0.6,
      fontSize: 28,
      canvasWidth: 720,
      maxLines: 1,
    });
    this.compareSubhead.set('正在逐 token 比较', 'muted');
    this.compareSubhead.sprite.position.set(0, 2.55, 0.12);
    this.compareGroup.add(this.compareSubhead.sprite);

    this.compareSourceLabel = createTextPlate({
      width: 1.6,
      height: 0.34,
      fontSize: 16,
      canvasWidth: 384,
      maxLines: 1,
    });
    this.compareSourceLabel.set('输入 token', 'r2');
    this.compareSourceLabel.sprite.position.set(-3.08, 1.72, 0.13);
    this.compareGroup.add(this.compareSourceLabel.sprite);
    this.compareCacheLabel = createTextPlate({
      width: 1.6,
      height: 0.34,
      fontSize: 16,
      canvasWidth: 384,
      maxLines: 1,
    });
    this.compareCacheLabel.set('已有缓存', 'cache');
    this.compareCacheLabel.sprite.position.set(-3.08, 1.04, 0.13);
    this.compareGroup.add(this.compareCacheLabel.sprite);

    const xs = [-1.95, -0.65, 0.65, 1.95];
    for (let index = 0; index < 4; index++) {
      const input = createTokenChip(0.66, 'r2');
      input.group.position.set(xs[index], 1.7, 0.14);
      this.compareGroup.add(input.group);
      this.compareInputs.push(input);
      const cached = createTokenChip(0.66, 'cache');
      cached.group.position.set(xs[index], 1.02, 0.14);
      this.compareGroup.add(cached.group);
      this.compareCached.push(cached);
      const status = createTextPlate({
        width: 1.22,
        height: 0.5,
        fontSize: 15,
        canvasWidth: 384,
        maxLines: 2,
      });
      status.set('比较中…', 'muted');
      status.sprite.position.set(xs[index], 0.58, 0.14);
      this.compareGroup.add(status.sprite);
      this.compareStatus.push(status);
      this.compareAnchors.push({
        input: this.compareGroup.position
          .clone()
          .add(new THREE.Vector3(xs[index], 1.86, 0.22)),
        cached: this.compareGroup.position
          .clone()
          .add(new THREE.Vector3(xs[index], 1.18, 0.22)),
      });
      const beam = createDynamicLine(MECH.cache, 0.0, 5);
      beam.line.visible = false;
      this.cacheDetail.add(beam.line);
      this.compareBeams.push(beam);
    }
  }

  private slotLocalTop(slotId: number): THREE.Vector3 {
    const cell = this.cacheBoard.cells[slotId];
    if (!cell) return new THREE.Vector3(0, 0.8, 0);
    return this.cacheBoard.group.position
      .clone()
      .add(new THREE.Vector3(cell.x, 0.98, cell.z));
  }

  private updateCache(
    event: MechanismEvent,
    progress: number,
    eased: number,
    state: MechanismState,
  ): void {
    const active = state.requests.find(
      (request) => request.id === event.requestId,
    );
    const activeReuse = Boolean(active && active.matchedPrefix > 0);
    const views: SlotView[] = state.slots.map((slot) => ({
      id: slot.id,
      token: slot.token,
      written: slot.written,
      cached: slot.cached,
      refs: [...slot.requestRefs],
      reusedBy:
        activeReuse && active?.prefixSlots.includes(slot.id)
          ? active.id
          : undefined,
      pending: false,
    }));
    const reservedGhosts =
      (event.kind === 'allocate' || event.id.endsWith('-prepare')) && progress < 1
        ? event.after.slots.filter(
            (slot) => !state.slots.some((existing) => existing.id === slot.id),
          )
        : [];
    for (const slot of reservedGhosts) {
      views.push({
        id: slot.id,
        token: slot.token,
        written: false,
        cached: false,
        refs: [...slot.requestRefs],
        pending: true,
      });
    }
    const writeIds =
      event.kind === 'prefill' || event.kind === 'decode'
        ? event.after.slots
            .filter(
              (slot) =>
                slot.written &&
                !event.before.slots.some(
                  (old) => old.id === slot.id && old.written,
                ),
            )
            .map((slot) => slot.id)
        : [];
    for (const view of views) {
      if (writeIds.includes(view.id) && progress < 1) {
        view.write = progress;
      }
    }
    const refOpacity = event.id.endsWith('.release') ? 1 - eased : 1;
    updateSlotBoard(this.cacheBoard, views, {
      detail: true,
      refOpacity,
      showRefs: ['R1', 'R2'],
    });

    const activeRequest = state.requests.find(
      (request) => request.id === event.requestId,
    );
    const activeEntry = activeRequest
      ? state.cache
          .map((entry) => {
            let matched = 0;
            while (
              matched < activeRequest.inputTokens.length &&
              matched < entry.tokens.length &&
              entry.tokens[matched] === activeRequest.inputTokens[matched]
            ) {
              matched++;
            }
            return { entry, matched };
          })
          .sort((a, b) => b.matched - a.matched)[0]
      : undefined;
    this.cachePathRows.forEach((row, index) => {
      const entry = state.cache[index];
      if (!entry) {
        row.label.set('', 'muted', 0);
        row.label.sprite.visible = false;
        row.chips.forEach((chip) => chip.setToken(null));
        return;
      }
      const active = activeEntry?.entry === entry;
      row.label.sprite.visible = true;
      row.label.set(
        `路径 ${index + 1}${active ? ' · 当前' : ''}\n${entry.slots
          .map((slot) => `#${String(slot).padStart(2, '0')}`)
          .join(' ')}`,
        active ? 'cache' : 'muted',
        active ? 1 : 0.72,
      );
      row.chips.forEach((chip, tokenIndex) => {
        const token = entry.tokens[tokenIndex];
        chip.setToken(token ?? null, active ? 'cache' : 'muted');
      });
    });

    const cached = state.slots.filter((slot) => slot.cached).length;
    const refs = state.slots.reduce((total, slot) => total + slot.requestRefs.length, 0);
    const releasing = event.id.endsWith('.release');
    this.cacheHint.set(
      `缓存路径 ${state.cache.length} 条 · 物理槽 ${state.slots.length}/${state.capacity}\n缓存持有 ${cached} · 请求引用 ${releasing ? '释放中' : refs}`,
      releasing ? 'reserved' : cached ? 'cache' : 'muted',
    );
    this.cacheLegend.set(
      releasing
        ? '释放中：请求引用 → 0\n缓存路径仍保留'
        : cached && refs
          ? '缓存持有 + 请求引用\n同槽位的两个生命周期'
          : cached
            ? '仅缓存持有\n请求引用已释放'
            : '尚未建立缓存路径',
      releasing ? 'reserved' : cached && refs ? 'cache' : 'muted',
      1,
    );
  }

  private updateCacheCompare(
    event: MechanismEvent,
    progress: number,
    state: MechanismState,
  ): void {
    for (const beam of this.compareBeams) {
      beam.line.visible = false;
      (beam.line.material as THREE.LineBasicMaterial).opacity = 0;
      (beam.line.material as THREE.LineBasicMaterial).color.setHex(MECH.cache);
    }
    const request = state.requests.find(
      (candidate) => candidate.id === event.requestId,
    );
    if (!request) return;
    const historical = request.id === 'R2';
    const matchIndex = this.trace.events.findIndex(candidate => candidate.id === `${request.id}.match`);
    const matchEvent = this.trace.events[matchIndex];
    const matchComplete = this.currentTime >= this.traceStarts[matchIndex] + matchEvent.duration;
    // Compare against the cache at lookup time. Later insertion of this request's
    // own prefix must never retroactively turn a two-token hit into a four-token hit.
    const lookupCache = historical ? matchEvent.before.cache : state.cache;
    const reference = lookupCache
      .map((entry) => {
        let matched = 0;
        while (
          matched < request.inputTokens.length &&
          matched < entry.tokens.length &&
          entry.tokens[matched] === request.inputTokens[matched]
        ) {
          matched++;
        }
        return { entry, matched };
      })
      .sort((a, b) => b.matched - a.matched)[0];
    const entry = reference?.entry;
    const refPrefix = historical ? request.matchedPrefix : 0;
    const comparing = event.kind === 'match' && progress < 1;
    const reveal = comparing ? Math.min(4, Math.floor(progress * 4) + 1) : 4;

    this.compareHead.set(
      historical
        ? 'R2 输入与已有前缀'
        : 'R1 建立缓存路径',
      historical ? 'cache' : 'r1',
    );
    this.compareSubhead.set(
      historical && !matchComplete && !comparing
        ? '等待本次请求的前缀查询'
        : comparing
        ? '逐 token 比较中'
        : historical
          ? refPrefix
            ? `命中 ${refPrefix} 个：复用 ${entry?.slots
                .slice(0, refPrefix)
                .map((slot) => `#${String(slot).padStart(2, '0')}`)
                .join(' ')}`
            : '没有可复用前缀'
          : entry
            ? '这是 R1 自己建立的路径，只表示缓存持有'
            : '缓存尚无路径，先分配再写入',
      historical && refPrefix ? 'cache' : 'muted',
    );
    this.compareSourceLabel.set(`${request.id} 输入`, requestTone(request.id));
    this.compareCacheLabel.set(
      historical ? '已有缓存路径' : '自身缓存路径',
      entry ? 'cache' : 'muted',
    );

    for (let index = 0; index < 4; index++) {
      const inputToken = request.inputTokens[index];
      const cachedToken = entry?.tokens[index];
      const same =
        cachedToken !== undefined &&
        inputToken !== undefined &&
        cachedToken === inputToken;
      const prefixSoFar =
        index === 0 ||
        (entry?.tokens
          .slice(0, index)
          .every((token, prefixIndex) => token === request.inputTokens[prefixIndex]) ??
          false);
      const reusing = Boolean(historical && same && prefixSoFar && index < refPrefix);
      const mismatch =
        entry !== undefined &&
        cachedToken !== undefined &&
        inputToken !== undefined &&
        !same &&
        prefixSoFar;
      let status: string;
      let tone: PlateTone;
      if (historical && !matchComplete && !comparing) {
        status = '等待查询';
        tone = 'muted';
      } else if (!entry) {
        status = '缓存为空\n等待写入';
        tone = 'muted';
      } else if (comparing && index >= reveal) {
        status = '逐项比较中…';
        tone = 'muted';
      } else if (mismatch) {
        status = '不同，停止';
        tone = 'signal';
      } else if (comparing && same && prefixSoFar) {
        status = '相同，继续';
        tone = 'muted';
      } else if (reusing) {
        status = `复用\n#${String(entry.slots[index]).padStart(2, '0')}`;
        tone = 'cache';
      } else if (historical && !prefixSoFar) {
        status = '前缀已停止\n需新分配';
        tone = 'reserved';
      } else if (same && !historical) {
        status = '自身前缀\n不计复用';
        tone = 'muted';
      } else {
        status = '相同，继续';
        tone = 'muted';
      }
      this.compareInputs[index].setToken(inputToken ?? '—', requestTone(request.id));
      this.compareCached[index].setToken(
        cachedToken ?? '—',
        reusing ? 'cache' : mismatch ? 'signal' : 'muted',
      );
      this.compareStatus[index].set(status, tone, entry ? 1 : 0.68);

      const beam = this.compareBeams[index];
      const shouldShow = Boolean(entry && historical && reusing && !comparing);
      if (!shouldShow) {
        beam.line.visible = false;
        (beam.line.material as THREE.LineBasicMaterial).opacity = 0;
        continue;
      }
      const anchor = this.compareAnchors[index];
      const slotId = entry?.slots[index];
      const slotPoint = slotId === undefined ? undefined : this.slotLocalTop(slotId);
      if (!slotPoint) {
        beam.line.visible = false;
        (beam.line.material as THREE.LineBasicMaterial).opacity = 0;
        continue;
      }
      const mid = anchor.cached.clone().lerp(slotPoint, 0.5);
      mid.y = Math.max(anchor.cached.y, slotPoint.y) + 0.45;
      beam.update([anchor.input, anchor.cached, mid, slotPoint]);
      (beam.line.material as THREE.LineBasicMaterial).color.setHex(
        historical ? MECH.cache : MECH.muted,
      );
      (beam.line.material as THREE.LineBasicMaterial).opacity = historical ? 0.78 : 0.3;
      beam.line.visible = true;
    }
  }

  private buildRails(): void {
    addDirectionalRail(
      this.scene,
      this.requestRoute.getPoints(32),
      MECH.r1,
      0.42,
      0.018,
    );
    addDirectionalRail(
      this.scene,
      this.queueRoute.getPoints(32),
      MECH.r1,
      0.4,
      0.018,
    );
    addDirectionalRail(
      this.scene,
      this.allocateRoute.getPoints(32),
      MECH.r2,
      0.5,
      0.018,
    );
    addDirectionalRail(
      this.scene,
      this.outboundRoute.getPoints(44),
      MECH.signal,
      0.48,
      0.02,
    );
    addDirectionalRail(
      this.scene,
      this.returnRoute.getPoints(48),
      MECH.write,
      0.45,
      0.019,
    );
    addDirectionalRail(
      this.scene,
      this.loopRoute.getPoints(32),
      MECH.cache,
      0.5,
      0.017,
    );
    addDirectionalRail(
      this.scene,
      this.releaseRoute.getPoints(24),
      MECH.cache,
      0.28,
      0.014,
    );
    addDirectionalRail(
      this.scene,
      this.outputRoute.getPoints(48),
      MECH.r2,
      0.38,
      0.018,
    );
    addDirectionalRail(
      this.scene,
      this.textRoute.getPoints(64),
      MECH.muted,
      0.2,
      0.012,
    );
    const cacheRail = tubeAlong(
      [vec(-4.8, 0.34, -1.7), vec(-4.8, 0.34, -3.6)],
      0.018,
      MECH.cache,
      0.36,
      24,
    );
    this.scene.add(cacheRail);
    this.rails.set('cache', [cacheRail]);
    const cacheReturn = tubeAlong(
      [vec(-3.5, 0.34, -3.6), vec(-3.5, 0.34, -1.7)],
      0.018,
      MECH.cache,
      0.36,
      24,
    );
    this.scene.add(cacheReturn);
    this.rails.get('cache')?.push(cacheReturn);
    const indexPlate = createTextPlate({
      width: 1.9,
      height: 0.34,
      fontSize: 15,
      canvasWidth: 512,
      maxLines: 1,
    });
    indexPlate.set('查询索引 / 映射，非 KV 数据', 'cache');
    indexPlate.sprite.position.set(-4.15, 0.62, -2.65);
    this.scene.add(indexPlate.sprite);
  }

  private buildRequestCards(): void {
    for (const id of ['R1', 'R2'] as const) {
      const card = createCardVisual(1.78, 0.95, requestTone(id));
      card.group.userData.nodeId = 'scheduler';
      this.scene.add(card.group);
      this.requestCards.set(id, card);
    }
  }

  private buildPackets(): void {
    const probe = this.prefixProbe;
    probe.group.userData.nodeId = 'cache';
    const forward = this.forwardPacket;
    forward.group.userData.nodeId = 'execution';
    this.returnPacket.group.userData.nodeId = 'model';
    this.resultToken.group.userData.nodeId = 'scheduler';
    this.nextInputToken.group.userData.nodeId = 'scheduler';
    this.textPacket.group.userData.nodeId = 'detokenizer';
    this.scene.add(probe.group, forward.group);
    this.scene.add(this.returnPacket.group, this.resultToken.group);
    this.scene.add(this.nextInputToken.group, this.textPacket.group);
  }

  private buildLabels(): void {
    this.labels.push(
      {
        id: 'queue-state',
        text: '等待 → 选批 → 运行',
        meta: '请求主体留在 Scheduler',
        anchor: WAITING.clone().add(new THREE.Vector3(0.1, 1.7, 0.25)),
        kind: 'state',
      },
      {
        id: 'cache-state',
        text: '缓存持有 ≠ 请求引用',
        meta: '物理槽可同时被缓存与请求引用',
        anchor: BASE_CACHE.clone().add(new THREE.Vector3(0, 2.68, 0.8)),
        kind: 'state',
      },
      {
        id: 'payload-boundary',
        text: '网络入口只传请求与 token',
        meta: 'K/V 留在设备池，不随请求卡传输',
        anchor: new THREE.Vector3(-8.2, 2.65, 1.1),
        kind: 'state',
      },
    );
  }

  // ------------------------------------------------------------------ states

  private refreshModuleState(): void {
    for (const [id, node] of this.moduleNodes) {
      const selected = this.selected === id;
      const hovered = this.hovered === id;
      const active = this.activeModules.has(id);
      node.ring.material.opacity = selected ? 0.8 : hovered ? 0.52 : active ? 0.32 : 0.12;
      node.ring.scale.setScalar(selected ? 1.04 : 1);
      node.group.scale.setScalar(selected ? 1.015 : 1);
    }
    this.cacheDetail.visible = this.selected === 'cache';
    this.executionDetail.visible = this.selected === 'execution';
    for (const { object, wrapper } of this.detailLayers) {
      wrapper.visible = this.selected === 'cache'
        ? object === this.moduleNodes.get('cache')?.group
        : this.selected === 'execution'
          ? object === this.executionDetail
          : true;
    }
    this.cacheBoard.cells.forEach((cell) => {
      cell.plate.sprite.visible = this.selected === 'cache';
    });
    this.executionHint.sprite.visible = this.selected !== 'execution';
    for (const spec of this.labels) {
      spec.visible = (this.selected === 'cache' || this.selected === 'execution') ? false : spec.nodeId
        ? !this.selected || spec.nodeId === this.selected
        : this.selected === null;
    }
  }

  private updateRequests(
    event: MechanismEvent,
    progress: number,
    eased: number,
    state: MechanismState,
    index: number,
  ): void {
    for (const request of state.requests) {
      const id = request.id;
      const card = this.requestCards.get(id);
      if (!card) continue;
      const first = this.trace.events.findIndex((candidate) => candidate.requestId === id);
      const visible = index >= first || (index === first && progress >= 0);
      card.group.visible = visible;
      if (!visible) continue;
      const own = event.requestId === id;
      const position = own
        ? this.requestPosition(event, progress, eased, request, state)
        : this.settledRequestPosition(id, state, index);
      card.group.position.copy(position);
      card.group.position.y += 0.22;
      const key = this.requestCardKey(id, request, event, progress, own);
      if (this.cardPlateKey.get(id) !== key) {
        this.cardPlateKey.set(id, key);
        let text: string;
        if (request.status === 'finished' && !own) {
          text = `${id} · 已完成\n输出 ${request.outputTokens.join(' ')}\nK/V 仍由缓存持有`;
        } else if (request.status === 'pending') {
          text = `${id} · 未进入\n输入 ${request.inputTokens.join(' ')}\n等待请求到达`;
        } else {
          const phase = own ? phaseText(event, request) : this.settledPhase(request);
          text = `${id} · ${phase}\n输入 ${request.inputTokens.join(' ')}\n输出 ${outputText(request)}`;
        }
        card.set(text, requestTone(id));
      }
    }
  }

  private requestCardKey(
    id: RequestId,
    request: MechanismRequest,
    event: MechanismEvent,
    progress: number,
    own: boolean,
  ): string {
    const stage = own ? `${event.id}:${progress < 1 ? 'run' : 'done'}` : request.status;
    return `${id}|${stage}|${request.outputTokens.length}|${request.matchedPrefix}|${request.status}`;
  }

  private requestPosition(
    event: MechanismEvent,
    _progress: number,
    eased: number,
    request: MechanismRequest,
    _state: MechanismState,
  ): THREE.Vector3 {
    const id = request.id;
    if (event.id.endsWith('.arrive')) {
      return this.requestRoute.getPoint(eased);
    }
    if (event.id.endsWith('.queue')) {
      return this.queueRoute.getPoint(eased);
    }
    if (event.id.endsWith('.match')) {
      return WAITING.clone();
    }
    if (event.id.endsWith('.allocate')) {
      return this.allocateRoute.getPoint(eased);
    }
    if (event.id.endsWith('.release')) {
      return this.releaseRoute.getPoint(eased);
    }
    if (event.id.endsWith('.output')) {
      return RESULT.clone();
    }
    if (event.kind === 'transport' && id === 'R2') {
      return API.clone();
    }
    return BATCH.clone();
  }

  private settledRequestPosition(
    id: RequestId,
    state: MechanismState,
    index: number,
  ): THREE.Vector3 {
    const last = this.trace.events
      .map((event, eventIndex) => ({ event, eventIndex }))
      .filter((candidate) => candidate.event.requestId === id && candidate.eventIndex < index)
      .at(-1)?.event;
    let position: THREE.Vector3;
    if (!last) {
      position = API.clone();
    } else if (last.id.endsWith('.arrive')) {
      position = TOKENIZER.clone();
    } else if (last.id.endsWith('.queue') || last.id.endsWith('.match')) {
      position = WAITING.clone();
    } else if (last.id.endsWith('.release')) {
      position = RESULT.clone();
    } else if (last.id.endsWith('.output')) {
      position = RESULT.clone();
    } else {
      position = BATCH.clone();
    }
    if (state.requests.find((request) => request.id === id)?.status === 'pending') {
      return API.clone();
    }
    return position;
  }

  private settledPhase(request: MechanismRequest): string {
    switch (request.status) {
      case 'pending':
        return '尚未进入';
      case 'tokenized':
        return '已分词';
      case 'waiting':
        return '等待选批';
      case 'prefill':
        return '预填充';
      case 'decode':
        return '继续解码';
      case 'finished':
        return '已完成';
    }
  }

  private updateScheduler(
    event: MechanismEvent,
    progress: number,
    state: MechanismState,
  ): void {
    const waiting = state.waiting.length;
    const mode = state.batch.mode;
    this.waitingDeck.material.emissiveIntensity = waiting ? 0.5 : 0.12;
    this.batchDeck.material.emissiveIntensity = mode === 'idle' ? 0.14 : 0.52;
    this.resultDeck.material.emissiveIntensity = state.batch.requestIds.length ? 0.28 : 0.12;
    this.waitingPlate.set(
      waiting ? `等待队列 · ${state.waiting.join(' + ')}` : '等待队列 · 空',
      waiting ? 'r2' : 'muted',
    );
    this.batchPlate.set(
      state.batch.requestIds.length
        ? `批次 · ${state.batch.requestIds.join(' + ')}`
        : '批次 / 运行位置',
      mode === 'idle' ? 'muted' : 'write',
    );
    this.batchModePlate.set(
      `批次：${batchText(mode)}${
        state.batch.requestIds.length ? ` · ${state.batch.requestIds.join(' ')}` : ''
      }`,
      mode === 'idle' ? 'muted' : 'write',
    );
    this.loopPlate.set(
      event.kind === 'decode' || event.id.endsWith('decode-preview') || event.id.includes('decode')
        ? '结果 → 再次解码'
        : '结果 → 下一轮',
      event.kind === 'decode' || event.kind === 'result' ? 'cache' : 'muted',
    );
    this.schedulerTitle.set(
      state.batch.requestIds.length
        ? `请求身份在 Scheduler · ${state.batch.requestIds.join(' ')}`
        : '同一请求身份停在 Scheduler',
      state.batch.requestIds.length ? 'r2' : 'neutral',
    );
    if (event.kind === 'allocate' && progress > 0.05) {
      this.batchDeck.material.emissiveIntensity = 0.35 + Math.sin(progress * Math.PI) * 0.25;
    }
  }

  private updateExecution(
    event: MechanismEvent,
    progress: number,
    state: MechanismState,
  ): void {
    const request = state.requests.find((candidate) => candidate.id === event.requestId);
    if (!request) return;
    const outputs = request.outputTokens;
    const inputFor = (index: number) => outputs[index];
    const slotFor = (token: number | undefined) => {
      if (token === undefined) return 'KV 待定';
      const slot = state.slots.find((candidate) => candidate.token === token);
      if (!slot) return 'KV 未分配';
      return slot.written
        ? `KV #${String(slot.id).padStart(2, '0')}`
        : `KV 待写入 #${String(slot.id).padStart(2, '0')}`;
    };
    this.executionTokenChips.forEach((chip, index) => {
      const token = outputs[index];
      chip.setToken(token ?? null, index === 0 ? 'write' : 'signal');
    });
    this.executionGates.forEach((gate, index) => {
      const input = inputFor(index);
      const inputChip = outputs[index + 1];
      const executing =
        (index === 0 && event.id.endsWith('.decode-1')) ||
        (index === 1 && event.id.endsWith('.decode-2'));
      const done = Boolean(inputChip);
      gate.plate.set(
        `forward ${index + 1}\n输入 ${input === undefined ? '待采样' : String(input)}`,
        executing ? 'signal' : done ? 'write' : 'muted',
      );
      gate.slot.set(
        input === undefined ? '上一输出成为输入' : slotFor(input),
        executing ? 'reserved' : done ? 'write' : 'muted',
      );
      gate.ring.material.opacity = executing ? 0.9 : done ? 0.45 : 0.18;
      gate.ring.scale.setScalar(executing ? 1 + Math.sin(progress * Math.PI) * 0.2 : 1);
    });
    this.executionLoop.set(
      outputs.length >= 2
        ? `输出 ${outputs[1]} 被接着喂回\n作为第 2 次 forward 的输入`
        : outputs.length
          ? '第一个输出只被采样\n等待下一轮 forward 写入 KV'
          : '先完成 Prefill\n才有第一个输出 token',
      outputs.length >= 2 ? 'signal' : 'muted',
    );
    this.lastOutputHint.sprite.visible = outputs.length >= 3;
    this.lastOutputHint.set(`${outputs.at(-1) ?? '…'} 未再输入\n没有 KV`, 'signal');
  }

  private updatePackets(
    event: MechanismEvent,
    progress: number,
    state: MechanismState,
  ): void {
    const packets = [
      this.prefixProbe,
      this.forwardPacket,
      this.returnPacket,
      this.resultToken,
      this.nextInputToken,
      this.textPacket,
    ];
    for (const packet of packets) {
      packet.group.visible = false;
      packet.group.position.set(0, 1, 0);
      packet.group.scale.setScalar(1);
    }
    const request = state.requests.find((candidate) => candidate.id === event.requestId);
    if (!request) return;
    const maxSlots = event.after.slots.length;
    if (event.kind === 'match') {
      const packet = this.prefixProbe;
      const movingOut = progress < 0.55;
      const routeT = movingOut
        ? smooth(progress / 0.55)
        : 1 - smooth((progress - 0.55) / 0.45);
      packet.group.position.copy(this.matchRoute.getPoint(routeT));
      packet.group.visible = true;
      packet.set(
        `${event.requestId} · 前缀查询\n${request.inputTokens.join(' ')}`,
        'cache',
      );
      packet.smallPlate.set(
        progress < 0.55
          ? '送往缓存，逐 token 比较'
          : progress < 0.9
            ? '比较中，尚未提交命中'
            : '比较完成，返回已有索引',
        'cache',
      );
    }
    if (event.kind === 'prefill' || event.kind === 'decode') {
      if (progress < 0.58) {
        const packet = this.forwardPacket;
        packet.group.visible = true;
        packet.group.position.copy(this.outboundRoute.getPoint(smooth(progress / 0.58)));
        const inputTokens =
          event.kind === 'prefill'
            ? request.inputTokens.slice(request.matchedPrefix)
            : [request.outputTokens.at(-1) ?? '上一输出'];
        packet.set(
          `${event.requestId} · 前向输入\n${
            event.kind === 'prefill' ? '未命中 ' : ''
          }${inputTokens.join(' ')}`,
          requestTone(event.requestId),
        );
        packet.smallPlate.set('Worker / Model 接收引用与输入', 'r2');
      } else {
        const packet = this.returnPacket;
        packet.group.visible = true;
        packet.group.position.copy(
          this.returnRoute.getPoint(smooth((progress - 0.58) / 0.42)),
        );
        const writeIds = event.after.slots
          .filter((slot) => !event.before.slots.some((old) => old.id === slot.id && old.written))
          .map((slot) => `#${String(slot.id).padStart(2, '0')}`);
        const done = progress >= 1;
        packet.set(
          `${event.requestId} · ${done ? '前向完成' : '前向处理中'}\n${
            done ? '写入' : '正在写入'
          } ${writeIds.join(' ') || '无新增'}`,
          'write',
        );
        packet.smallPlate.set(
          `${done ? '设备池写入完成' : 'KV 尚未提交'} · ${maxSlots}/12`,
          'write',
        );
      }
    }
    if (event.kind === 'result') {
      const packet = this.resultToken;
      packet.group.visible = true;
      packet.group.position.copy(
        this.returnRoute.getPoint(this.resultTokenProgress(event, progress)),
      );
      const token = event.after.requests.find((candidate) => candidate.id === event.requestId)
        ?.outputTokens.at(-1);
      packet.set(`${event.requestId} · 新采样输出\n${token ?? '…'}`, requestTone(event.requestId));
      packet.smallPlate.set('本轮新 token 回到调度器结果区', 'write');
    }
    if (event.id.endsWith('-prepare')) {
      const packet = this.nextInputToken;
      packet.group.visible = true;
      packet.group.position.copy(this.loopRoute.getPoint(smooth(progress)));
      const token = event.after.slots.at(-1)?.token ?? request.outputTokens.at(-1);
      packet.set(`${event.requestId} · 下一轮输入\n${token ?? '…'}`, requestTone(event.requestId));
      packet.smallPlate.set('上一轮输出 → 新的可写位置', 'cache');
    }
    if (event.id.endsWith('.release')) {
      const packet = this.returnPacket;
      packet.group.visible = progress > 0.35;
      packet.group.position.copy(
        this.releaseRoute.getPoint(smooth((progress - 0.35) / 0.65)),
      );
      packet.set(`${event.requestId} · 释放请求引用\nK/V 留给缓存`, 'cache');
      packet.smallPlate.set('引用归零，物理槽不消失', 'cache');
    }
    if (event.id.endsWith('.output')) {
      const packet = this.resultToken;
      packet.group.visible = true;
      packet.group.position.copy(
        this.outputRoute.getPoint(smooth(Math.min(1, progress / 0.45))),
      );
      packet.set(
        `${event.requestId} · 输出 token\n${request.outputTokens.join(' ')}`,
        requestTone(event.requestId),
      );
      packet.smallPlate.set(
        progress < 0.45 ? 'token 正在送往反分词器' : 'token 已到达，等待转文本',
        'r2',
      );
      if (progress >= 0.45) {
        const text = this.textPacket;
        text.group.visible = true;
        text.group.position.copy(
          this.textRoute.getPoint(smooth((progress - 0.45) / 0.55)),
        );
        text.set(`${event.requestId} · 文本回告`, 'write');
        text.smallPlate.set('token 到达后才开始转文本并回告', 'write');
      }
    }
  }

  private resultTokenProgress(event: MechanismEvent, progress: number): number {
    if (event.id.endsWith('.prefill-result')) return smooth(progress);
    return smooth(progress);
  }
}

export function createMechanismScene(options: {
  sharedPrefix?: boolean;
  reducedMotion?: boolean;
} = {}): SceneHandle {
  return new MechanismScene(options);
}
