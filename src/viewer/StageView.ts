import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type {
  FocusPoint,
  LaneDefinition,
  OverlayLabelSpec,
  SceneHandle,
  ScenePlaybackContext,
  StepRenderContext,
} from './types';
import { disposeObject } from './three/toolkit';
import { sampleCameraPath, validateCameraPath, type CameraKeyframe } from './three/camera-path';

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

interface StageViewOptions {
  lane: LaneDefinition;
  handle: SceneHandle;
  reducedMotion: boolean;
  onSelect: (nodeId: string | null) => void;
  onCameraChange?: (pose: CameraPose) => void;
}

interface LabelBinding {
  spec: OverlayLabelSpec;
  element: HTMLElement;
  interactive: boolean;
  leader: HTMLDivElement;
}

interface CameraTween {
  path: CameraKeyframe[];
  elapsed: number;
  duration: number;
}

const LABEL_ANCHOR_OFFSET = 0.02;

export class StageView {
  readonly root: HTMLDivElement;
  readonly handle: SceneHandle;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly labelLayer: HTMLDivElement;
  private readonly labels: LabelBinding[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly abort = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly reducedMotion: boolean;
  private readonly lane: LaneDefinition;
  private readonly onSelect: (nodeId: string | null) => void;
  private readonly onCameraChange?: (pose: CameraPose) => void;
  private applyingCamera = false;
  private readonly pickables: THREE.Object3D[] = [];
  private readonly clock = new THREE.Clock();
  private frameId: number | null = null;
  private cameraTween: CameraTween | null = null;
  private stepKey = '';
  private activeNodes = new Set<string>();
  private selectedNode: string | null = null;
  private hoveredNode: string | null = null;
  private pointerDown: { x: number; y: number; id: number } | null = null;
  private visible = true;
  private pageVisible = !document.hidden;
  private disposed = false;
  private hasRendered = false;
  private contextLost = false;
  private sampledPlayback = false;

  constructor(container: HTMLElement, options: StageViewOptions) {
    this.handle = options.handle;
    this.lane = options.lane;
    this.reducedMotion = options.reducedMotion;
    this.onSelect = options.onSelect;
    this.onCameraChange = options.onCameraChange;
    this.root = document.createElement('div');
    this.root.className = 'imv-stage';
    this.root.dataset.lane = options.lane.id;
    this.root.dataset.laneAvailable = String(options.lane.available);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'imv-canvas';
    this.canvas.setAttribute(
      'aria-label',
      `${options.lane.label} 的可旋转三维机制图。可拖拽旋转、滚轮缩放；节点标签与节点列表可用键盘访问。`,
    );
    this.canvas.tabIndex = 0;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'imv-label-layer';
    this.labelLayer.setAttribute('aria-label', '三维场景节点标签');
    this.root.append(this.canvas, this.labelLayer);

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      this.root.remove();
      throw error;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0d1b1e, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
    this.camera.position.copy(this.handle.home.position);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.copy(this.handle.home.target);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = 2.8;
    this.controls.maxDistance = 36;
    this.controls.minPolarAngle = 0.14;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.update();
    this.camera.lookAt(this.handle.home.target);

    this.buildLights();
    this.renderer.compileAsync?.(this.handle.scene, this.camera).catch(() => undefined);

    this.pickables = [];
    this.handle.scene.traverse((object) => {
      if (object.userData.nodeId) {
        this.pickables.push(object);
      }
    });

    container.append(this.root);
    this.buildLabels(options.lane);
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.visible = Boolean(entry?.isIntersecting);
        if (this.visible) {
          this.invalidate();
        } else {
          this.stopLoop();
        }
      },
      { rootMargin: '80px' },
    );
    this.intersectionObserver.observe(this.root);
    this.resize();
    this.invalidate();
  }

  setStep(context: Omit<StepRenderContext, 'lane' | 'reducedMotion'>): void {
    if (this.disposed) {
      return;
    }
    const key = `${context.scenario.id}:${context.step.id}:${context.stepIndex}`;
    if (key === this.stepKey) return;
    this.stepKey = key;
    this.handle.setStep({
      ...context,
      lane: this.lane,
      reducedMotion: this.reducedMotion,
    });
    this.invalidate();
  }

  setPlayback(context: Omit<ScenePlaybackContext, 'lane' | 'reducedMotion'>): void {
    if (this.disposed) return;
    if (!this.handle.setPlayback) {
      this.setStep(context);
      return;
    }
    this.sampledPlayback = true;
    this.handle.setPlayback({ ...context, lane: this.lane, reducedMotion: this.reducedMotion });
    this.invalidate();
  }

  setActiveNodes(nodeIds: string[]): void {
    this.activeNodes = new Set(nodeIds);
    this.refreshLabelClasses();
    this.invalidate();
  }

  setSelected(nodeId: string | null): void {
    this.selectedNode = nodeId;
    this.handle.setSelected(nodeId);
    this.refreshLabelClasses();
    this.invalidate();
  }

  setHovered(nodeId: string | null): void {
    if (this.hoveredNode === nodeId) {
      return;
    }
    this.hoveredNode = nodeId;
    this.handle.setHovered?.(nodeId);
    this.refreshLabelClasses();
    this.invalidate();
  }

  focusNode(nodeId: string): void {
    const focus = this.handle.focus[nodeId];
    if (!focus) {
      return;
    }
    this.flyTo(focus);
  }

  getCameraPose(): CameraPose {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray() };
  }

  /** Synchronize an orbit gesture without re-emitting it to the other viewport. */
  setCameraPose(pose: CameraPose): void {
    if (this.disposed) return;
    this.cameraTween = null;
    this.applyingCamera = true;
    try {
      this.camera.position.fromArray(pose.position);
      this.controls.target.fromArray(pose.target);
      this.controls.update();
      this.camera.lookAt(this.controls.target);
    } finally {
      this.applyingCamera = false;
    }
    this.invalidate();
  }

  resetCamera(): void {
    this.flyTo(this.handle.home);
  }

  invalidate(): void {
    if (this.disposed || !this.visible || !this.pageVisible || this.contextLost) {
      return;
    }
    if (this.frameId !== null) {
      return;
    }
    this.frameId = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abort.abort();
    this.stopLoop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.controls.dispose();
    this.labels.forEach(({ element }) => element.remove());
    this.labels.length = 0;
    this.handle.dispose();
    disposeObject(this.handle.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.root.remove();
  }

  private buildLights(): void {
    const ambient = new THREE.HemisphereLight(0xdfeee5, 0x0a1515, 1.45);
    this.handle.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffe7c7, 2.4);
    key.position.set(7, 12, 8);
    this.handle.scene.add(key);
    const fill = new THREE.DirectionalLight(0x79c8d5, 1.0);
    fill.position.set(-10, 5, 6);
    this.handle.scene.add(fill);
    const rim = new THREE.PointLight(0xd96743, 10, 18, 1.8);
    rim.position.set(-6, 5, -5);
    this.handle.scene.add(rim);
    const teal = new THREE.PointLight(0x72d3c8, 7, 16, 2);
    teal.position.set(5, 3.2, 3);
    this.handle.scene.add(teal);
  }

  private buildLabels(lane: LaneDefinition): void {
    for (const spec of this.handle.labels) {
      const interactive = Boolean(spec.nodeId);
      const element = document.createElement(
        interactive ? 'button' : 'div',
      ) as HTMLButtonElement | HTMLDivElement;
      element.className = `imv-node-label imv-node-label--${spec.kind ?? 'node'}`;
      if (interactive) {
        const button = element as HTMLButtonElement;
        button.type = 'button';
        button.dataset.nodeId = spec.nodeId;
        button.addEventListener('click', () => {
          if (spec.nodeId) {
            this.onSelect(spec.nodeId);
          }
        }, { signal: this.abort.signal });
        button.addEventListener('pointerenter', () => {
          if (spec.nodeId) {
            this.setHovered(spec.nodeId);
          }
        }, { signal: this.abort.signal });
        button.addEventListener('pointerleave', () => {
          this.setHovered(null);
        }, { signal: this.abort.signal });
        button.setAttribute(
          'aria-label',
          `${spec.text}${spec.meta ? `，${spec.meta}` : ''}，打开节点档案`,
        );
      } else {
        element.setAttribute('aria-hidden', 'true');
      }
      const title = document.createElement('span');
      title.className = 'imv-node-label__title';
      title.textContent = spec.text;
      element.append(title);
      if (spec.meta) {
        const meta = document.createElement('span');
        meta.className = 'imv-node-label__meta';
        meta.textContent = spec.meta;
        element.append(meta);
      }
      element.dataset.lane = lane.id;
      const leader = document.createElement('div');
      leader.className = 'imv-label-leader';
      leader.hidden = true;
      leader.setAttribute('aria-hidden', 'true');
      this.labelLayer.append(leader, element);
      this.labels.push({ spec, element, interactive, leader });
    }
  }

  private refreshLabelClasses(): void {
    for (const { spec, element, interactive } of this.labels) {
      if (!interactive) {
        continue;
      }
      const nodeId = spec.nodeId;
      element.classList.toggle('is-active', Boolean(nodeId && this.activeNodes.has(nodeId)));
      element.classList.toggle('is-selected', Boolean(nodeId && nodeId === this.selectedNode));
      element.classList.toggle('is-hovered', Boolean(nodeId && nodeId === this.hoveredNode));
      element.classList.toggle(
        'is-muted',
        Boolean(nodeId && this.activeNodes.size > 0 && !this.activeNodes.has(nodeId)),
      );
    }
  }

  private bindEvents(): void {
    document.addEventListener('visibilitychange', () => {
      this.pageVisible = !document.hidden;
      if (!this.pageVisible) {
        this.stopLoop();
      } else {
        this.invalidate();
      }
    }, { signal: this.abort.signal });

    this.controls.addEventListener('change', () => {
      this.cameraTween = null;
      this.invalidate();
      if (!this.applyingCamera) this.onCameraChange?.(this.getCameraPose());
    });
    this.controls.addEventListener('start', () => {
      this.cameraTween = null;
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      this.pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { signal: this.abort.signal });
    this.canvas.addEventListener('pointerup', (event) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      if (!down || down.id !== event.pointerId) {
        return;
      }
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
        return;
      }
      const hit = this.pick(event);
      this.onSelect(hit);
    }, { signal: this.abort.signal });
    this.canvas.addEventListener('pointermove', (event) => {
      if (event.buttons !== 0) {
        return;
      }
      const hit = this.pick(event);
      this.setHovered(hit);
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
    }, { signal: this.abort.signal });
    this.canvas.addEventListener('pointerleave', () => {
      this.setHovered(null);
    }, { signal: this.abort.signal });
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.stopLoop();
      const note = document.createElement('div');
      note.className = 'imv-webgl-note';
      note.setAttribute('role', 'alert');
      note.innerHTML =
        '<strong>3D 上下文已丢失</strong><span>刷新页面可重建场景；节点档案仍可阅读。</span>';
      this.root.append(note);
    }, { signal: this.abort.signal });
  }

  private pick(event: PointerEvent): string | null {
    if (this.disposed) {
      return null;
    }
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) {
      return null;
    }
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.pickables, true);
    for (const hit of intersections) {
      let object: THREE.Object3D | null = hit.object;
      let nodeId: string | null = null;
      let visible = true;
      while (object) {
        if (!object.visible) visible = false;
        if (typeof object.userData.nodeId === 'string') nodeId ??= object.userData.nodeId;
        object = object.parent;
      }
      if (visible && nodeId) return nodeId;
    }
    return null;
  }

  private flyTo(focus: FocusPoint): void {
    const adjusted = this.adjustForAspect(focus);
    if (this.reducedMotion) {
      this.camera.position.copy(adjusted.position);
      this.controls.target.copy(adjusted.target);
      this.controls.update();
      this.camera.lookAt(adjusted.target);
      this.cameraTween = null;
      this.invalidate();
      return;
    }
    const duration = 0.6;
    const path: CameraKeyframe[] = [
      { time: 0, target: this.controls.target.toArray(), offset: this.camera.position.clone().sub(this.controls.target).toArray() },
      { time: duration, target: adjusted.target.toArray(), offset: adjusted.position.clone().sub(adjusted.target).toArray() },
    ];
    validateCameraPath(path);
    this.cameraTween = { path, elapsed: 0, duration };
    this.invalidate();
  }

  private adjustForAspect(focus: FocusPoint): FocusPoint {
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const scale = aspect >= 1.1 ? 1 : 1 + (1.1 - Math.max(aspect, 0.45)) * 0.6;
    const position = focus.position.clone();
    const target = focus.target.clone();
    position.sub(target).multiplyScalar(scale).add(target);
    return { position, target };
  }

  private resize(): void {
    if (this.disposed) {
      return;
    }
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private tick = (): void => {
    this.frameId = null;
    if (this.disposed || !this.visible || !this.pageVisible || this.contextLost) {
      return;
    }
    const delta = Math.min(0.05, this.clock.getDelta());
    let moving = false;
    if (this.cameraTween) {
      const tween = this.cameraTween;
      tween.elapsed = Math.min(tween.duration, tween.elapsed + delta);
      const pose = sampleCameraPath(tween.path, tween.elapsed);
      this.controls.target.fromArray(pose.target);
      this.camera.position.fromArray(pose.offset).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      moving = tween.elapsed < tween.duration;
      if (!moving) {
        this.cameraTween = null;
      }
    }
    const sceneMoving = this.sampledPlayback ? false : this.handle.update(delta);
    this.renderer.render(this.handle.scene, this.camera);
    this.updateLabels();
    this.hasRendered = true;
    if (sceneMoving || moving) {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private updateLabels(): void {
    const width = this.root.clientWidth, height = this.root.clientHeight;
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    const priority = (b: LabelBinding) => b.spec.nodeId === this.selectedNode ? 4
      : b.spec.nodeId && this.activeNodes.has(b.spec.nodeId) ? 3 : b.interactive ? 2 : 1;
    const ordered = [...this.labels].sort((a, b) => priority(b) - priority(a));
    for (const { spec, element, leader } of ordered) {
      leader.hidden = true;
      const relevant = !spec.nodeId || !this.activeNodes.size || this.activeNodes.has(spec.nodeId)
        || spec.nodeId === this.selectedNode || spec.nodeId === this.hoveredNode;
      if (spec.visible === false || !relevant) { element.hidden = true; continue; }
      const anchor = (typeof spec.anchor === 'function' ? spec.anchor() : spec.anchor).clone();
      anchor.y += LABEL_ANCHOR_OFFSET;
      const projected = anchor.project(this.camera);
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      if (projected.z <= -1 || projected.z >= 1 || x < 0 || x > width || y < 0 || y > height) {
        element.hidden = true; continue;
      }
      element.hidden = false;
      const w = element.offsetWidth, h = element.offsetHeight;
      let position: { x: number; y: number; w: number; h: number } | undefined;
      for (const dx of [0, -70, 70]) {
        for (const dy of [0, -40, 40, -80, 80, -120]) {
          const candidate = {
            x: Math.max(5, Math.min(width - w - 5, x - w / 2 + dx)),
            y: Math.max(5, Math.min(height - h - 5, y - h + dy)), w, h,
          };
          if (occupied.every(b => candidate.x + w + 6 < b.x || b.x + b.w + 6 < candidate.x
            || candidate.y + h + 5 < b.y || b.y + b.h + 5 < candidate.y)) {
            position = candidate; break;
          }
        }
        if (position) break;
      }
      if (!position) { element.hidden = true; continue; }
      occupied.push(position);
      element.style.transform = `translate(${Math.round(position.x)}px, ${Math.round(position.y)}px)`;
      element.style.zIndex = String(spec.nodeId === this.selectedNode ? 110 : 105);
      const endX = position.x + w / 2, endY = position.y + h;
      const dx = endX - x, dy = endY - y, distance = Math.hypot(dx, dy);
      if (distance > 7) {
        leader.hidden = false;
        leader.style.width = `${distance}px`;
        leader.style.transform = `translate(${x}px, ${y}px) rotate(${Math.atan2(dy, dx)}rad)`;
      }
    }
  }

  private stopLoop(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  get rendered(): boolean {
    return this.hasRendered;
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
