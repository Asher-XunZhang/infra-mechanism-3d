import type {
  LaneDefinition,
  LaneFact,
  MountedViewer,
  SceneDefinition,
  ScenarioDefinition,
  ViewerEvent,
  ViewerOptions,
  ViewerState,
  ViewerStep,
} from './types';
import {
  advancePlayback,
  getScenario,
  getScene,
  moduleIdsForScene,
  parseLocationHash,
  pausePlayback,
  resetSteps,
  selectModule,
  serializeLocation,
  setStep,
  sourceUrl,
  stateFromLocation,
  stepBackward,
  stepForward,
  switchLaneMode,
  switchScenario,
  switchScene,
  togglePlayback,
  visibleLaneIds,
} from './state';
import { StageView } from './StageView';
import { disposeObject } from './three/toolkit';
import viewerCss from './viewer.css?inline';

const SHELL = `
<section class="imv" data-ref="root">
  <header class="imv-bar">
    <div class="imv-brand">
      <span class="imv-brand__mark" aria-hidden="true">IM</span>
      <div class="imv-brand__copy">
        <strong>机制图</strong>
        <span>INFRA MECHANISM VIEWER</span>
      </div>
    </div>
    <nav class="imv-nav" data-ref="nav" aria-label="场景切换"></nav>
    <div class="imv-bar__meta" data-ref="bar-meta"></div>
  </header>
  <div class="imv-context" data-ref="context"></div>
  <div class="imv-tools" data-ref="tools"></div>
  <div class="imv-main">
    <section class="imv-visual" aria-label="三维场景与阅读控制">
      <div class="imv-lanes" data-ref="lanes"></div>
      <p class="imv-caption" data-ref="caption"></p>
      <div class="imv-transport" data-ref="transport"></div>
    </section>
    <aside class="imv-inspector">
      <div class="imv-guide" data-ref="guide"></div>
      <div class="imv-dossier" data-ref="dossier"></div>
    </aside>
  </div>
  <div class="imv-lower" data-ref="lower"></div>
  <footer class="imv-foot" data-ref="foot"></footer>
  <p class="imv-sr" data-ref="live" aria-live="polite" aria-atomic="true"></p>
</section>`;

const FALLBACK_HINT =
  '此浏览器没有可用的 WebGL 上下文。三维结构改为文本阅读；步骤、条件与模块档案仍可操作。';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function safeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? escapeHtml(value) : '#';
}

function externalLink(url: string, label: string, className = ''): string {
  return `<a class="${className}" href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context =
      canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) {
      return false;
    }
    const lose = (context as WebGLRenderingContext).getExtension(
      'WEBGL_lose_context',
    );
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function conditionLabel(status: string): string {
  switch (status) {
    case 'pass':
      return '通过';
    case 'fail':
      return '不通过';
    case 'assumed':
      return '明确假设';
    default:
      return '跳过';
  }
}

export class MechanismViewer implements MountedViewer {
  readonly element: HTMLElement;
  private readonly pack: ViewerOptions['pack'];
  private readonly options: ViewerOptions;
  private readonly shadow: ShadowRoot;
  private readonly root: HTMLElement;
  private readonly navEl: HTMLElement;
  private readonly barMetaEl: HTMLElement;
  private readonly contextEl: HTMLElement;
  private readonly toolsEl: HTMLElement;
  private readonly lanesEl: HTMLElement;
  private readonly captionEl: HTMLElement;
  private readonly transportEl: HTMLElement;
  private readonly guideEl: HTMLElement;
  private readonly dossierEl: HTMLElement;
  private readonly lowerEl: HTMLElement;
  private readonly footEl: HTMLElement;
  private readonly liveEl: HTMLElement;
  private readonly abort = new AbortController();
  private readonly stageViews = new Map<string, StageView>();
  private readonly laneFoots = new Map<string, HTMLElement>();
  private readonly fallbacks = new Map<string, HTMLElement>();
  private readonly boundary: IntersectionObserver;
  private readonly media: MediaQueryList;
  private stateValue: ViewerState;
  private reducedMotion: boolean;
  private playTimer: number | null = null;
  private viewKey = '';
  private webglSupported: boolean;
  private inView = true;
  private disposed = false;

  constructor(container: HTMLElement, options: ViewerOptions) {
    this.pack = options.pack;
    this.options = options;
    if (!this.pack.scenes.length) {
      throw new Error('A viewer pack needs at least one scene.');
    }
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.media.matches;
    this.webglSupported = hasWebGL();

    const parsed = options.syncHash === false
      ? {}
      : parseLocationHash(window.location.hash);
    this.stateValue = stateFromLocation(this.pack, parsed, {
      initialSceneId: options.initialSceneId,
      initialLaneMode: options.initialLaneMode,
    });

    this.element = document.createElement('div');
    this.element.className = 'imv-host';
    this.element.tabIndex = 0;
    this.element.dataset.imv = 'host';
    this.shadow = this.element.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = viewerCss;
    const holder = document.createElement('div');
    holder.innerHTML = SHELL;
    const shell = holder.firstElementChild;
    if (!(shell instanceof HTMLElement)) {
      throw new Error('Unable to create the viewer shell.');
    }
    this.shadow.append(style, shell);
    this.root = shell;
    this.navEl = this.requireRef(shell, 'nav');
    this.barMetaEl = this.requireRef(shell, 'bar-meta');
    this.contextEl = this.requireRef(shell, 'context');
    this.toolsEl = this.requireRef(shell, 'tools');
    this.lanesEl = this.requireRef(shell, 'lanes');
    this.captionEl = this.requireRef(shell, 'caption');
    this.transportEl = this.requireRef(shell, 'transport');
    this.guideEl = this.requireRef(shell, 'guide');
    this.dossierEl = this.requireRef(shell, 'dossier');
    this.lowerEl = this.requireRef(shell, 'lower');
    this.footEl = this.requireRef(shell, 'foot');
    this.liveEl = this.requireRef(shell, 'live');

    this.root.dataset.reducedMotion = String(this.reducedMotion);
    this.bindEvents();
    this.boundary = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        this.inView = Boolean(entry?.isIntersecting);
        if (!this.inView) {
          this.pauseForVisibility();
        }
        this.syncPlaybackTimer();
      },
      { threshold: 0.04 },
    );
    this.boundary.observe(this.root);

    container.append(this.element);
    this.refreshScene();
    this.writeHash();
    this.syncPlaybackTimer();
    this.emit({ type: 'ready' });
  }

  static mount(container: HTMLElement, options: ViewerOptions): MechanismViewer {
    return new MechanismViewer(container, options);
  }

  destroy(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopPlaybackTimer();
    this.abort.abort();
    this.boundary.disconnect();
    this.disposeStages();
    this.emit({ type: 'destroy' });
    this.element.remove();
  }

  getState(): ViewerState {
    return { ...this.stateValue };
  }

  setScene(sceneId: string): void {
    const previous = this.stateValue;
    const next = switchScene(
      this.pack,
      this.stateValue,
      sceneId,
      this.stateValue.laneMode,
    );
    this.applyState(previous, next);
  }

  setScenario(scenarioId: string): void {
    const previous = this.stateValue;
    const next = switchScenario(this.scene(), this.stateValue, scenarioId);
    this.applyState(previous, next);
  }

  setLaneMode(mode: ViewerState['laneMode']): void {
    const previous = this.stateValue;
    const next = switchLaneMode(this.scene(), this.stateValue, mode);
    this.applyState(previous, next);
  }

  setStep(stepIndex: number): void {
    const previous = this.stateValue;
    const next = setStep(this.scenario(), this.stateValue, stepIndex);
    this.applyState(previous, next);
  }

  selectModule(moduleId: string | null): void {
    const normalized =
      moduleId && this.pack.modules[moduleId] ? moduleId : null;
    const previous = this.stateValue;
    let next = selectModule(this.stateValue, normalized);
    if (normalized) {
      next = pausePlayback(next);
    }
    this.applyState(previous, next);
  }

  resetCamera(): void {
    for (const stage of this.stageViews.values()) {
      stage.resetCamera();
    }
  }

  private requireRef(scope: ParentNode, name: string): HTMLElement {
    const element = scope.querySelector<HTMLElement>(`[data-ref="${name}"]`);
    if (!element) {
      throw new Error(`Viewer shell is missing [data-ref="${name}"]`);
    }
    return element;
  }

  private bindEvents(): void {
    const signal = this.abort.signal;
    this.shadow.addEventListener('click', this.handleClick, { signal });
    this.shadow.addEventListener('keydown', this.handleKeydown, { signal });
    document.addEventListener('keydown', this.handleGlobalKeydown, { signal });
    document.addEventListener('visibilitychange', this.handleVisibility, {
      signal,
    });
    window.addEventListener('hashchange', this.handleHashChange, { signal });
    this.media.addEventListener('change', this.handleMotionChange, { signal });
  }

  private handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLElement>(
      'button, [data-select-module], [data-clear-module]',
    );
    if (!button) {
      return;
    }
    if (button.dataset.sceneId) {
      this.setScene(button.dataset.sceneId);
      this.restoreFocus(`[data-scene-id="${this.cssEscape(button.dataset.sceneId)}"]`);
      return;
    }
    if (button.dataset.scenarioId) {
      const scenarioId = button.dataset.scenarioId;
      this.setScenario(scenarioId);
      this.restoreFocus(
        `[data-scenario-id="${this.cssEscape(scenarioId)}"]`,
      );
      return;
    }
    if (button.dataset.laneMode) {
      const mode = button.dataset.laneMode as ViewerState['laneMode'];
      this.setLaneMode(mode);
      this.restoreFocus(`[data-lane-mode="${mode}"]`);
      return;
    }
    if (button.dataset.stepIndex) {
      const index = Number.parseInt(button.dataset.stepIndex, 10);
      this.setStep(index);
      this.restoreFocus(
        `[data-step-index="${this.stateValue.stepIndex}"]`,
      );
      return;
    }
    if (button.dataset.selectModule) {
      const moduleId = button.dataset.selectModule;
      this.selectModule(moduleId);
      this.restoreFocus(
        `[data-select-module="${this.cssEscape(moduleId)}"]`,
      );
      return;
    }
    if (button.hasAttribute('data-clear-module')) {
      this.selectModule(null);
      this.restoreFocus('[data-clear-module]');
      return;
    }
    switch (button.dataset.action) {
      case 'previous':
        this.pauseAndStep((scenario, state) => stepBackward(scenario, state));
        this.restoreFocus(
          `[data-step-index="${this.stateValue.stepIndex}"]`,
        );
        break;
      case 'next':
        this.pauseAndStep((scenario, state) => stepForward(scenario, state));
        this.restoreFocus(
          `[data-step-index="${this.stateValue.stepIndex}"]`,
        );
        break;
      case 'play':
        this.togglePlayback();
        this.restoreFocus('[data-action="play"]');
        break;
      case 'reset':
        this.pauseAndStep((scenario, state) => resetSteps(scenario, state));
        this.restoreFocus('[data-action="reset"]');
        break;
      case 'reset-camera':
        this.resetCamera();
        break;
      case 'reset-lane': {
        const laneId = button.dataset.laneId;
        if (laneId) {
          this.stageViews.get(laneId)?.resetCamera();
        }
        break;
      }
      default:
        break;
    }
  };

  private handleKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const moduleButton = target.closest<HTMLElement>('[data-select-module]');
    if (!moduleButton) {
      return;
    }
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!direction) {
      return;
    }
    const buttons = [
      ...this.shadow.querySelectorAll<HTMLElement>('[data-select-module]'),
    ];
    if (!buttons.length) {
      return;
    }
    event.preventDefault();
    const index = buttons.indexOf(moduleButton);
    const next = buttons[(index + direction + buttons.length) % buttons.length];
    next?.focus();
  };

  private handleGlobalKeydown = (event: KeyboardEvent): void => {
    const path = event.composedPath();
    if (!path.includes(this.element)) return;
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }
    const target = path[0];
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, [contenteditable="true"], button, a[href]',
      )
    ) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.pauseAndStep((scenario, state) => stepForward(scenario, state));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.pauseAndStep((scenario, state) => stepBackward(scenario, state));
    } else if (event.key === ' ') {
      event.preventDefault();
      this.togglePlayback();
    } else if (event.key.toLowerCase() === 'r') {
      this.pauseAndStep((scenario, state) => resetSteps(scenario, state));
    } else if (event.key.toLowerCase() === 'c') {
      this.resetCamera();
    }
  };

  private handleHashChange = (): void => {
    if (this.options.syncHash === false || this.disposed) {
      return;
    }
    const previous = this.stateValue;
    const next = stateFromLocation(
      this.pack,
      parseLocationHash(window.location.hash),
      {
        initialSceneId: this.options.initialSceneId,
        initialLaneMode: this.options.initialLaneMode,
      },
    );
    this.applyState(previous, next, { writeHash: false });
  };

  private handleVisibility = (): void => {
    if (document.hidden) {
      this.pauseForVisibility();
    }
    this.syncPlaybackTimer();
  };

  private handleMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.root.dataset.reducedMotion = String(this.reducedMotion);
    if (this.reducedMotion) {
      this.pauseForVisibility();
    }
    this.refreshScene();
  };

  private pauseForVisibility(): void {
    if (!this.stateValue.playing) {
      return;
    }
    const previous = this.stateValue;
    this.stateValue = pausePlayback(this.stateValue);
    this.applyState(previous, this.stateValue);
  }

  private pauseAndStep(
    transition: (
      scenario: ScenarioDefinition,
      state: ViewerState,
    ) => ViewerState,
  ): void {
    const previous = this.stateValue;
    const next = transition(this.scenario(), pausePlayback(this.stateValue));
    this.applyState(previous, next);
  }

  private togglePlayback(): void {
    const previous = this.stateValue;
    const next = togglePlayback(this.scenario(), this.stateValue);
    this.applyState(previous, next);
    this.syncPlaybackTimer();
  }

  private syncPlaybackTimer(): void {
    if (this.disposed) {
      return;
    }
    const shouldRun =
      this.stateValue.playing && this.inView && !document.hidden;
    if (!shouldRun) {
      this.stopPlaybackTimer();
      return;
    }
    if (this.playTimer !== null) {
      return;
    }
    this.playTimer = window.setInterval(() => {
      if (this.disposed) {
        this.stopPlaybackTimer();
        return;
      }
      const previous = this.stateValue;
      const next = advancePlayback(this.scenario(), this.stateValue);
      if (
        next.stepIndex === previous.stepIndex &&
        next.playing === previous.playing
      ) {
        this.stopPlaybackTimer();
        return;
      }
      this.applyState(previous, next);
      if (!next.playing) {
        this.stopPlaybackTimer();
      }
    }, 2800);
  }

  private stopPlaybackTimer(): void {
    if (this.playTimer !== null) {
      window.clearInterval(this.playTimer);
      this.playTimer = null;
    }
  }

  private applyState(
    previous: ViewerState,
    next: ViewerState,
    options: { focusSelector?: string; writeHash?: boolean } = {},
  ): void {
    if (this.disposed) {
      return;
    }
    const sceneChanged = previous.sceneId !== next.sceneId;
    const stepChanged = previous.stepIndex !== next.stepIndex;
    const moduleChanged = previous.moduleId !== next.moduleId;
    this.stateValue = next;

    this.refreshScene();

    if (moduleChanged && next.moduleId) {
      for (const stage of this.stageViews.values()) {
        stage.focusNode(next.moduleId);
      }
    }

    if (sceneChanged) {
      this.emit({ type: 'scene-change', sceneId: next.sceneId });
    }
    if (stepChanged) {
      this.emit({
        type: 'step-change',
        stepIndex: next.stepIndex,
        stepId: this.step().id,
      });
    }
    if (moduleChanged) {
      this.emit({ type: 'module-select', moduleId: next.moduleId });
    }
    if (options.writeHash !== false) {
      this.writeHash();
    }
    if (options.focusSelector) {
      this.restoreFocus(options.focusSelector);
    }
    this.syncPlaybackTimer();
  }

  private refreshScene(): void {
    const scene = this.scene();
    const key = `${scene.id}:${this.stateValue.sceneId}:${this.stateValue.laneMode}:${this.reducedMotion}:${this.webglSupported}`;
    if (key !== this.viewKey) {
      this.viewKey = key;
      this.rebuildStages();
    }
    this.renderChrome();
    this.renderTransport();
    this.renderGuide();
    this.renderDossier();
    this.renderLower();
    this.renderFoot();
    this.syncStages();
    this.updateLaneFoots();
    this.captionEl.textContent = scene.instructions ?? '';
    this.liveEl.textContent = `第 ${this.stateValue.stepIndex + 1} 步，共 ${this.scenario().steps.length} 步：${this.step().title}`;
  }

  private rebuildStages(): void {
    this.disposeStages();
    const scene = this.scene();
    const lanes = this.lanesForView();
    this.lanesEl.innerHTML = lanes
      .map((lane) => this.laneMarkup(lane, scene))
      .join('');
    this.lanesEl.dataset.count = String(lanes.length);
    this.root.dataset.compare = String(scene.mode === 'compare');
    this.root.dataset.lanes = String(lanes.length);

    for (const lane of lanes) {
      const host = this.lanesEl.querySelector<HTMLElement>(
        `[data-lane-host="${this.cssEscape(lane.id)}"]`,
      );
      const foot = this.lanesEl.querySelector<HTMLElement>(
        `[data-lane-foot="${this.cssEscape(lane.id)}"]`,
      );
      if (!host) {
        continue;
      }
      if (foot) {
        this.laneFoots.set(lane.id, foot);
      }
      this.buildLaneStage(lane, host);
    }
    this.root.dataset.viewKey = this.viewKey;
  }

  private buildLaneStage(lane: LaneDefinition, host: HTMLElement): void {
    const scene = this.scene();
    if (!this.webglSupported) {
      this.buildFallback(
        lane,
        host,
        this.options.fallbackOnNoWebGL === false
          ? '按配置未启用 WebGL 自动降级；三维视图不可用，以下保留文本阅读。'
          : FALLBACK_HINT,
      );
      return;
    }
    let handle;
    try {
      handle = scene.buildLane({
        lane,
        scene,
        laneIndex: scene.lanes.findIndex((candidate) => candidate.id === lane.id),
        laneCount: this.lanesForView().length,
        reducedMotion: this.reducedMotion,
      });
      const stage = new StageView(host, {
        lane,
        handle,
        reducedMotion: this.reducedMotion,
        onCameraChange: (pose) => {
          for (const [otherId, other] of this.stageViews) {
            if (otherId !== lane.id) other.setCameraPose(pose);
          }
        },
        onSelect: (nodeId) => {
          this.selectModule(nodeId);
        },
      });
      this.stageViews.set(lane.id, stage);
      const step = this.step();
      stage.setStep({
        scenario: this.scenario(),
        step,
        stepIndex: this.stateValue.stepIndex,
        stepCount: this.scenario().steps.length,
      });
      stage.setActiveNodes(step.moduleIds);
      stage.setSelected(this.stateValue.moduleId);
      if (this.stateValue.moduleId) {
        stage.focusNode(this.stateValue.moduleId);
      }
    } catch (error) {
      handle?.dispose();
      if (handle) {
        disposeObject(handle.scene);
      }
      host.replaceChildren();
      const reason =
        error instanceof Error && error.message.includes('WebGL')
          ? 'WebGL 初始化失败，三维视图不可用。'
          : FALLBACK_HINT;
      this.buildFallback(lane, host, reason);
    }
  }

  private buildFallback(lane: LaneDefinition, host: HTMLElement, hint: string): void {
    const element = document.createElement('div');
    element.className = 'imv-fallback';
    element.dataset.fallbackLane = lane.id;
    element.innerHTML = `<p class="imv-fallback__hint">${escapeHtml(hint)}</p>`;
    host.append(element);
    this.fallbacks.set(lane.id, element);
    this.updateFallback(lane);
  }

  private updateFallback(lane: LaneDefinition): void {
    const element = this.fallbacks.get(lane.id);
    if (!element) {
      return;
    }
    const step = this.step();
    const modules = step.moduleIds
      .map((id) => this.pack.modules[id])
      .filter(Boolean);
    const points = step.points ?? [];
    element.innerHTML = `
      <div class="imv-fallback__head">
        <span class="imv-kicker">NO WEBGL · 文本阅读</span>
        <strong>${escapeHtml(step.title)}</strong>
      </div>
      <p class="imv-fallback__brief">${escapeHtml(step.summary)}</p>
      ${
        points.length
          ? `<ul class="imv-fallback__points">${points
              .map((point) => `<li>${escapeHtml(point)}</li>`)
              .join('')}</ul>`
          : ''
      }
      <p class="imv-fallback__note">${escapeHtml(lane.note)}</p>
      <div class="imv-fallback__modules">
        ${modules
          .map(
            (module) =>
              `<button type="button" class="imv-chip" data-select-module="${escapeHtml(module.id)}" data-accent="${escapeHtml(module.accent)}">${escapeHtml(module.title)}</button>`,
          )
          .join('')}
      </div>
      <p class="imv-fallback__hint">${escapeHtml(
        '三维结构不可用，但上方步骤、下方条件与模块索引仍然可操作。',
      )}</p>`;
  }

  private disposeStages(): void {
    for (const stage of this.stageViews.values()) {
      stage.dispose();
    }
    this.stageViews.clear();
    this.laneFoots.clear();
    this.fallbacks.clear();
  }

  private renderChrome(): void {
    const scene = this.scene();
    this.root.dataset.scene = scene.id;
    this.root.dataset.mode = scene.mode;
    this.navEl.innerHTML = this.pack.scenes
      .map(
        (candidate, index) => `
          <button type="button" class="imv-nav__button" data-scene-id="${escapeHtml(candidate.id)}" aria-pressed="${candidate.id === scene.id}">
            <span class="imv-nav__num">${String(index + 1).padStart(2, '0')}</span>
            <span>${escapeHtml(candidate.navLabel)}</span>
          </button>`,
      )
      .join('');
    this.barMetaEl.innerHTML = `
      <span class="imv-bar__flag">固定源码</span>
      <span>审阅 ${escapeHtml(this.pack.reviewDate)}</span>
      <span class="imv-bar__keys">← → 步进 · 空格 播放 · C 视角</span>`;

    const provenance = scene.provenance;
    const commits = provenance.commit
      .split(/\s*\/\s*/)
      .filter(Boolean)
      .map((commit) =>
        /^[0-9a-f]{7,40}$/i.test(commit)
          ? externalLink(
              `${provenance.repository}/tree/${commit}`,
              `<code>${escapeHtml(commit.slice(0, 10))}</code>`,
              'imv-commit__link',
            )
          : `<code>${escapeHtml(commit)}</code>`,
      )
      .join('<span class="imv-commit__sep">/</span>');
    this.contextEl.innerHTML = `
      <div class="imv-context__copy">
        <p class="imv-kicker">${escapeHtml(scene.kicker)}</p>
        <h2>${escapeHtml(scene.title)}</h2>
        <p class="imv-description">${escapeHtml(scene.description)}</p>
      </div>
      <div class="imv-provenance">
        <div class="imv-provenance__row">
          <span>版本 / commit</span>
          <div class="imv-commit">${commits}</div>
        </div>
        <div class="imv-provenance__row">
          <span>${escapeHtml(provenance.label)}</span>
          <p>${escapeHtml(provenance.scope)}</p>
        </div>
      </div>`;

    const scenario = this.scenario();
    const scenarioButtons =
      scene.scenarios.length > 1
        ? `<div class="imv-tools__group" role="group" aria-label="场景分支">
            <span class="imv-tools__label">分支</span>
            ${scene.scenarios
              .map(
                (candidate) => `
                <button type="button" class="imv-tab" data-scenario-id="${escapeHtml(candidate.id)}" data-tone="${escapeHtml(candidate.id)}" aria-pressed="${candidate.id === scenario.id}">
                  ${escapeHtml(candidate.label)}
                </button>`,
              )
              .join('')}
          </div>`
        : '';
    const laneOptions: Array<{ id: ViewerState['laneMode']; label: string }> =
      scene.lanes.length > 1
        ? [
            { id: 'both', label: '双栏' },
            ...scene.lanes.map((lane) => ({
              id: (lane.id === 'v0520' ? 'left' : 'right') as ViewerState['laneMode'],
              label: lane.version,
            })),
          ]
        : [];
    const laneButtons = laneOptions.length
      ? `<div class="imv-tools__group" role="group" aria-label="版本视图">
          <span class="imv-tools__label">视图</span>
          ${laneOptions
            .map(
              (option) => `
              <button type="button" class="imv-tab" data-lane-mode="${option.id}" aria-pressed="${option.id === this.stateValue.laneMode}">
                ${escapeHtml(option.label)}
              </button>`,
            )
            .join('')}
        </div>`
      : '';
    const graphAssumption = scenario.conditions?.find(
      (condition) => condition.id === 'graph-headroom',
    );
    this.toolsEl.innerHTML = `
      <div class="imv-tools__left">
        ${scenarioButtons}
        ${laneButtons}
        ${
          graphAssumption
            ? `<span class="imv-assumption" title="${escapeHtml(graphAssumption.detail)}">Graph 余量 · ${escapeHtml(conditionLabel(graphAssumption.status))}</span>`
            : ''
        }
        ${
          !scenarioButtons && !laneButtons
            ? '<span class="imv-tools__hint">拖拽旋转 · 滚轮缩放 · 点击 3D 节点或标签查看模块档案</span>'
            : ''
        }
      </div>
      <div class="imv-tools__right">
        <button type="button" class="imv-button imv-button--quiet" data-action="reset-camera">⌖ 视角复位</button>
      </div>`;
  }

  private laneMarkup(lane: LaneDefinition, scene: SceneDefinition): string {
    const commit = lane.commit
      ? `${lane.commit.slice(0, 10)}`
      : scene.provenance.shortCommit;
    const commitLink = /^[0-9a-f]{7,40}$/i.test(lane.commit)
      ? externalLink(
          `${scene.provenance.repository}/tree/${lane.commit}`,
          `<code>${escapeHtml(commit)}</code>`,
          'imv-commit__link',
        )
      : `<code>${escapeHtml(commit)}</code>`;
    const tone = lane.available ? 'available' : 'blocked';
    return `
      <article class="imv-lane" data-lane-id="${escapeHtml(lane.id)}" data-accent="${escapeHtml(lane.accent)}" data-available="${lane.available}">
        <header class="imv-lane__head">
          <div class="imv-lane__identity">
            <span class="imv-lane__dot" aria-hidden="true"></span>
            <div>
              <h3>${escapeHtml(lane.label)}</h3>
              <span class="imv-lane__version">${escapeHtml(lane.version)}</span>
            </div>
          </div>
          <span class="imv-pill" data-tone="${tone}">${escapeHtml(lane.status)}</span>
        </header>
        <div class="imv-lane__meta">
          ${commitLink}
          <span>${escapeHtml(lane.note)}</span>
        </div>
        <div class="imv-lane__stage" data-lane-host="${escapeHtml(lane.id)}"></div>
        <div class="imv-lane__foot">
          <span data-lane-foot="${escapeHtml(lane.id)}"></span>
          <button type="button" class="imv-lane__reset" data-action="reset-lane" data-lane-id="${escapeHtml(lane.id)}">视角</button>
        </div>
      </article>`;
  }

  private renderTransport(): void {
    const scenario = this.scenario();
    const step = this.step();
    const canPlay = scenario.steps.length > 1;
    this.transportEl.innerHTML = `
      <div class="imv-transport__rail" role="group" aria-label="阅读步骤">
        <button type="button" class="imv-stepnav" data-action="previous" aria-label="上一步" title="上一步（←）" ${this.stateValue.stepIndex === 0 ? 'disabled' : ''}>←</button>
        <div class="imv-steps">
          ${scenario.steps
            .map(
              (candidate, index) => `
              <button type="button" class="imv-step" data-step-index="${index}" aria-pressed="${index === this.stateValue.stepIndex}" title="${escapeHtml(candidate.title)}">
                <span class="imv-step__num">${String(index + 1).padStart(2, '0')}</span>
                <span class="imv-step__label">${escapeHtml(candidate.label)}</span>
              </button>`,
            )
            .join('')}
        </div>
        <button type="button" class="imv-stepnav" data-action="next" aria-label="下一步" title="下一步（→）" ${this.stateValue.stepIndex >= scenario.steps.length - 1 ? 'disabled' : ''}>→</button>
      </div>
      <div class="imv-transport__meta">
        <span class="imv-step-count"><strong>${String(this.stateValue.stepIndex + 1).padStart(2, '0')}</strong> / ${String(scenario.steps.length).padStart(2, '0')} · ${escapeHtml(step.label)}</span>
        <span class="imv-transport__note">步骤与镜头是阅读控制，不是实测耗时</span>
        <div class="imv-transport__actions">
          <button type="button" class="imv-button" data-action="play" ${canPlay ? '' : 'disabled'}>${this.stateValue.playing ? 'Ⅱ 暂停' : '▶ 播放'}</button>
          <button type="button" class="imv-button imv-button--quiet" data-action="reset">重置</button>
        </div>
      </div>
      <div class="imv-progress" aria-hidden="true"><span style="width:${((this.stateValue.stepIndex + 1) / scenario.steps.length) * 100}%"></span></div>`;
  }

  private renderGuide(): void {
    const scenario = this.scenario();
    const step = this.step();
    const facts = scenario.steps.length
      ? step.laneFacts
        ? this.scene().lanes
            .map((lane) => {
              const fact = step.laneFacts?.[lane.id];
              return fact ? { lane, fact } : null;
            })
            .filter((entry): entry is { lane: LaneDefinition; fact: LaneFact } =>
              Boolean(entry),
            )
        : []
      : [];
    this.guideEl.innerHTML = `
      <div class="imv-section-head">
        <span class="imv-section-num">01</span>
        <span>READING STEP</span>
        <span class="imv-section-rule"></span>
        <span>${escapeHtml(scenario.label)}</span>
      </div>
      <p class="imv-guide__kicker">第 ${String(this.stateValue.stepIndex + 1).padStart(2, '0')} 步 / ${String(scenario.steps.length).padStart(2, '0')}</p>
      <h3 class="imv-guide__title">${escapeHtml(step.title)}</h3>
      <p class="imv-guide__summary">${escapeHtml(step.summary)}</p>
      ${
        step.points?.length
          ? `<ul class="imv-guide__points">${step.points
              .map((point) => `<li>${escapeHtml(point)}</li>`)
              .join('')}</ul>`
          : ''
      }
      ${
        facts.length
          ? `<div class="imv-facts">${facts
              .map(
                ({ lane, fact }) => `
                <div class="imv-fact" data-tone="${escapeHtml(fact.tone)}" data-lane="${escapeHtml(lane.id)}">
                  <div class="imv-fact__head">
                    <span class="imv-fact__lane">${escapeHtml(lane.version)}</span>
                    <span class="imv-fact__status">${escapeHtml(fact.status)}</span>
                  </div>
                  <p>${escapeHtml(fact.detail)}</p>
                </div>`,
              )
              .join('')}</div>`
          : ''
      }
      ${scenario.note ? `<p class="imv-guide__note">${escapeHtml(scenario.note)}</p>` : ''}
    `;
  }

  private renderDossier(): void {
    const moduleId = this.stateValue.moduleId;
    const module = moduleId ? this.pack.modules[moduleId] : undefined;
    if (!module) {
      const scene = this.scene();
      const sceneModuleIds = new Set(moduleIdsForScene(scene));
      this.dossierEl.innerHTML = `
        <div class="imv-section-head">
          <span class="imv-section-num">02</span>
          <span>NODE DOSSIER</span>
          <span class="imv-section-rule"></span>
          <span>可下钻</span>
        </div>
        <h3 class="imv-dossier__empty-title">选一个节点，读它的边界</h3>
        <p class="imv-dossier__empty-copy">
          点击三维节点、场景标签，或下方“模块索引”。键盘可用 Tab 遍历，方向键在索引中移动。
        </p>
        <div class="imv-groupcards">
          ${this.pack.groups
            .map((group) => {
              const count = Object.values(this.pack.modules).filter(
                (candidate) =>
                  candidate.groupId === group.id &&
                  sceneModuleIds.has(candidate.id),
              ).length;
              return `
                <div class="imv-groupcard" data-kind="${group.kind}">
                  <span class="imv-groupcard__label">${escapeHtml(group.label)}</span>
                  <span class="imv-groupcard__count">${count} 个节点</span>
                  <p>${escapeHtml(group.detail)}</p>
                </div>`;
            })
            .join('')}
        </div>`;
      return;
    }
    const group = this.pack.groups.find(
      (candidate) => candidate.id === module.groupId,
    );
    this.dossierEl.innerHTML = `
      <div class="imv-section-head">
        <span class="imv-section-num">02</span>
        <span>NODE DOSSIER</span>
        <span class="imv-section-rule"></span>
        <span>${escapeHtml(group?.label ?? '模块')}</span>
      </div>
      <div class="imv-dossier__title" data-accent="${escapeHtml(module.accent)}">
        <span class="imv-orb" aria-hidden="true"></span>
        <div>
          <p class="imv-kicker">${escapeHtml(module.directory)}</p>
          <h3>${escapeHtml(module.title)}</h3>
          <code>${escapeHtml(module.name)}</code>
        </div>
        <button type="button" class="imv-close" data-clear-module aria-label="关闭节点档案">×</button>
      </div>
      <p class="imv-dossier__summary">${escapeHtml(module.summary)}</p>
      <div class="imv-dossier__block">
        <h4>为什么重要</h4>
        <p>${escapeHtml(module.why)}</p>
      </div>
      <div class="imv-dossier__block">
        <h4>源码行为</h4>
        <p>${escapeHtml(module.action)}</p>
      </div>
      <div class="imv-dossier__block">
        <h4>对象 / 数据</h4>
        <ul>${module.objects.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="imv-dossier__block imv-dossier__block--boundary">
        <h4>边界 / 别混淆</h4>
        <ul>${module.boundaries.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="imv-dossier__block">
        <h4>固定源码</h4>
        ${this.sourceList(module.sourceIds, true)}
      </div>`;
  }

  private renderLower(): void {
    const scenario = this.scenario();
    const conditions = scenario.conditions ?? [];
    const changes = scenario.changes ?? [];
    const step = this.step();
    const stepSources = step.sourceIds ?? [];
    const moduleSources = this.stateValue.moduleId
      ? this.pack.modules[this.stateValue.moduleId]?.sourceIds ?? []
      : [];
    const sources = [...new Set([...stepSources, ...moduleSources])];
    const sceneModuleIds = new Set(moduleIdsForScene(this.scene()));
    const groupedModules = this.pack.groups
      .map((group) => ({
        group,
        modules: Object.values(this.pack.modules).filter(
          (module) =>
            module.groupId === group.id && sceneModuleIds.has(module.id),
        ),
      }))
      .filter((entry) => entry.modules.length > 0);

    this.lowerEl.innerHTML = `
      <div class="imv-lower__grid">
        <section class="imv-panel">
          <div class="imv-section-head">
            <span class="imv-section-num">03</span>
            <span>CONDITIONS</span>
            <span class="imv-section-rule"></span>
            <span>${conditions.length} 项</span>
          </div>
          ${
            conditions.length
              ? `<ol class="imv-conditions">${conditions
                  .map(
                    (condition) => `
                    <li class="imv-condition" data-status="${escapeHtml(condition.status)}">
                      <span class="imv-condition__glyph" aria-hidden="true">${conditionIcon(condition.status)}</span>
                      <div>
                        <strong>${escapeHtml(condition.label)}</strong>
                        <span class="imv-condition__status">${escapeHtml(conditionLabel(condition.status))}</span>
                        <p>${escapeHtml(condition.detail)}</p>
                        ${condition.sourceIds ? this.sourceList(condition.sourceIds, false) : ''}
                      </div>
                    </li>`,
                  )
                  .join('')}</ol>`
              : `<p class="imv-empty">这个场景没有额外的运行时门槛；它是结构阅读地图，不宣称一次真实请求的耗时。</p>`
          }
        </section>
        <section class="imv-panel">
          <div class="imv-section-head">
            <span class="imv-section-num">04</span>
            <span>VERSION DELTA</span>
            <span class="imv-section-rule"></span>
            <span>${changes.length ? `${changes.length} 项变化` : '单版本'}</span>
          </div>
          ${
            changes.length
              ? `<details class="imv-changes" ${this.scene().mode === 'compare' ? 'open' : ''}>
                  <summary>对照变更模块与 before / after</summary>
                  <div class="imv-changes__list">
                    ${changes
                      .map((change) => {
                        const module = this.pack.modules[change.moduleId];
                        return `
                          <div class="imv-change" data-tone="${escapeHtml(change.tone)}">
                            <button type="button" class="imv-change__module" data-select-module="${escapeHtml(change.moduleId)}">${escapeHtml(module?.title ?? change.label)}</button>
                            <span class="imv-change__label">${escapeHtml(change.label)}</span>
                            <div class="imv-change__states">
                              <span><em>旧</em>${escapeHtml(change.oldState)}</span>
                              <span><em>新</em>${escapeHtml(change.newState)}</span>
                            </div>
                          </div>`;
                      })
                      .join('')}
                  </div>
                </details>`
              : `<p class="imv-empty">普通链路只使用一个固定源码基线；版本差异集中在“PD 角色切换”场景，不把主地图 commit 与前缀对比混用。</p>`
          }
        </section>
        <section class="imv-panel imv-panel--modules">
          <div class="imv-section-head">
            <span class="imv-section-num">05</span>
            <span>MODULE INDEX</span>
            <span class="imv-section-rule"></span>
            <span>${sceneModuleIds.size} 个模块</span>
          </div>
          <p class="imv-panel__hint">Tab 进入，方向键移动，Enter / Space 打开档案。</p>
          <div class="imv-index">
            ${groupedModules
              .map(
                ({ group, modules }) => `
                <div class="imv-index__group">
                  <h4>${escapeHtml(group.label)}</h4>
                  <div class="imv-index__buttons">
                    ${modules
                      .map(
                        (module) => `
                        <button type="button" class="imv-module" data-select-module="${escapeHtml(module.id)}" data-accent="${escapeHtml(module.accent)}" aria-pressed="${module.id === this.stateValue.moduleId}" title="${escapeHtml(module.summary)}">
                          <span class="imv-module__title">${escapeHtml(module.title)}</span>
                          <span class="imv-module__name">${escapeHtml(module.name)}</span>
                        </button>`,
                      )
                      .join('')}
                  </div>
                </div>`,
              )
              .join('')}
          </div>
        </section>
        <section class="imv-panel">
          <div class="imv-section-head">
            <span class="imv-section-num">06</span>
            <span>SOURCE EVIDENCE</span>
            <span class="imv-section-rule"></span>
            <span>${sources.length} 个锚点</span>
          </div>
          <p class="imv-panel__hint">当前步骤与选中模块的固定源码位置；只读静态核对，不运行 SGLang。</p>
          ${this.sourceList(sources, true)}
        </section>
      </div>`;
  }

  private renderFoot(): void {
    const notes = this.pack.notes.slice(0, 3);
    this.footEl.innerHTML = `
      <div class="imv-foot__mark">
        <span>NOTICE</span>
        <strong>${escapeHtml(this.pack.title)}</strong>
      </div>
      <ul class="imv-foot__notes">
        ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="imv-foot__legal">
        <span>只读源码证据 · 非性能实测</span>
        <span>MIT · Asher-XunZhang</span>
        ${externalLink(
          this.pack.repository,
          'sgl-project/sglang ↗',
          'imv-foot__link',
        )}
        ${externalLink(
          this.pack.repository,
          '仓库与证据说明 ↗',
          'imv-foot__link',
        )}
      </div>`;
  }

  private sourceList(sourceIds: string[], detailed: boolean): string {
    const anchors = sourceIds
      .map((id) => this.pack.sourceAnchors[id])
      .filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor));
    if (!anchors.length) {
      return '<p class="imv-empty imv-empty--small">本步没有单独列出的源码锚点。</p>';
    }
    if (!detailed) {
      return `<div class="imv-source-inline">${anchors
        .slice(0, 5)
        .map(
          (anchor) =>
            externalLink(
              sourceUrl(anchor),
              escapeHtml(anchor.label),
              'imv-source-link',
            ),
        )
        .join('')}</div>`;
    }
    return `<ul class="imv-sources">${anchors
      .map(
        (anchor) => `
        <li>
          <div class="imv-source__head">
            ${externalLink(
              sourceUrl(anchor),
              `<code>${escapeHtml(anchor.symbol)}</code>`,
              'imv-source__symbol',
            )}
            <span>${escapeHtml(anchor.label)}</span>
          </div>
          <p>${escapeHtml(anchor.path)} · <code>${escapeHtml(anchor.commit.slice(0, 10))}</code></p>
          ${anchor.note ? `<p class="imv-source__note">${escapeHtml(anchor.note)}</p>` : ''}
        </li>`,
      )
      .join('')}</ul>`;
  }

  private syncStages(): void {
    for (const stage of this.stageViews.values()) {
      const step = this.step();
      stage.setStep({
        scenario: this.scenario(),
        step,
        stepIndex: this.stateValue.stepIndex,
        stepCount: this.scenario().steps.length,
      });
      stage.setActiveNodes(step.moduleIds);
      stage.setSelected(this.stateValue.moduleId);
    }
    for (const lane of this.lanesForView()) this.updateFallback(lane);
  }

  private updateLaneFoots(): void {
    const step = this.step();
    for (const lane of this.lanesForView()) {
      const foot = this.laneFoots.get(lane.id);
      if (!foot) {
        continue;
      }
      const fact = step.laneFacts?.[lane.id];
      const tone = fact?.tone ?? (lane.available ? 'available' : 'blocked');
      const status = fact?.status ?? lane.status;
      foot.innerHTML = `<span class="imv-lane__fact" data-tone="${escapeHtml(tone)}">${escapeHtml(status)}</span>`;
      foot.title = fact?.detail ?? lane.note;
    }
  }

  private writeHash(): void {
    if (this.options.syncHash === false) {
      return;
    }
    const next = serializeLocation(this.pack, this.stateValue);
    if (window.location.hash !== next) {
      window.history.replaceState(null, '', next);
    }
  }

  private restoreFocus(selector: string): void {
    window.requestAnimationFrame(() => {
      if (this.disposed) {
        return;
      }
      const target = this.shadow.querySelector<HTMLElement>(selector);
      target?.focus({ preventScroll: true });
    });
  }

  private cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
  }

  private scene(): SceneDefinition {
    return getScene(this.pack, this.stateValue.sceneId);
  }

  private scenario(): ScenarioDefinition {
    return getScenario(this.scene(), this.stateValue.scenarioId);
  }

  private step(): ViewerStep {
    const scenario = this.scenario();
    return scenario.steps[this.stateValue.stepIndex] ?? scenario.steps[0];
  }

  private lanesForView(): LaneDefinition[] {
    const scene = this.scene();
    const ids = visibleLaneIds(scene, this.stateValue.laneMode);
    return ids
      .map((id) => scene.lanes.find((lane) => lane.id === id))
      .filter((lane): lane is LaneDefinition => Boolean(lane));
  }

  private emit(event: ViewerEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Consumer callbacks must not break the viewer lifecycle.
    }
  }
}

function conditionIcon(status: string): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'fail':
      return '×';
    case 'assumed':
      return '≈';
    default:
      return '–';
  }
}

export function mountViewer(
  container: HTMLElement,
  options: ViewerOptions,
): MechanismViewer {
  return MechanismViewer.mount(container, options);
}
