import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
} from 'react';
import { visibleLaneIds } from '../state';
import { formatReadingTime } from '../timeline';
import type { LaneDefinition, ModuleDoc } from '../types';
import { FallbackStage } from './FallbackStage';
import type { ViewerUiController, ViewerUiSnapshot } from './types';

function lanesFor(snapshot: ViewerUiSnapshot): LaneDefinition[] {
  const ids = visibleLaneIds(snapshot.scene, snapshot.state.laneMode);
  return ids
    .map((id) => snapshot.scene.lanes.find((lane) => lane.id === id))
    .filter((lane): lane is LaneDefinition => Boolean(lane));
}

function modulesFor(snapshot: ViewerUiSnapshot): ModuleDoc[] {
  return snapshot.step.moduleIds
    .map((id) => snapshot.pack.modules[id])
    .filter((module): module is ModuleDoc => Boolean(module));
}

function StageSlot({
  viewer,
  lane,
  sceneId,
  optionsKey,
  reducedMotion,
}: {
  viewer: ViewerUiController;
  lane: LaneDefinition;
  sceneId: string;
  optionsKey: string;
  reducedMotion: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    viewer.bindStage(lane.id, host);
    return () => viewer.unbindStage(lane.id, host);
  }, [viewer, lane.id, sceneId, optionsKey, reducedMotion]);

  return <div ref={hostRef} className="imv-stage-slot" />;
}

function LanePanel({
  viewer,
  snapshot,
  lane,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  lane: LaneDefinition;
}) {
  const fact = snapshot.step.laneFacts?.[lane.id];
  const factTone = fact?.tone ?? (lane.available ? 'available' : 'blocked');
  const factStatus = fact?.status ?? lane.status;
  const failure = snapshot.stageFailures[`${snapshot.scene.id}:${lane.id}`];
  const fallback = !snapshot.webglSupported || Boolean(failure);
  const reason = failure
    ? failure
    : !snapshot.webglSupported
      ? snapshot.fallbackOnNoWebGL
        ? '此浏览器没有可用的 WebGL 上下文。三维结构改为文本阅读；步骤、条件与模块档案仍可操作。'
        : '按配置未启用 WebGL 自动降级；三维视图不可用，以下保留文本阅读。'
      : '';
  const modules = modulesFor(snapshot);

  return (
    <article
      className="imv-lane"
      data-lane-id={lane.id}
      data-accent={lane.accent}
      data-available={String(lane.available)}
    >
      <header className="imv-lane__head">
        <div className="imv-lane__identity">
          <span className="imv-lane__dot" aria-hidden="true" />
          <div>
            <h3>{lane.label}</h3>
            <span className="imv-lane__version">{lane.version}</span>
          </div>
        </div>
        <span
          className="imv-pill"
          data-tone={lane.available ? 'available' : 'blocked'}
        >
          {lane.status}
        </span>
      </header>
      <div className="imv-lane__meta">
        <code>{lane.commit.slice(0, 10)}</code>
        <span>{lane.note}</span>
      </div>
      <div className="imv-lane__stage">
        {fallback ? (
          <FallbackStage
            step={snapshot.step}
            lane={lane}
            modules={modules}
            reason={reason}
            eyebrow={
              failure ? '3D 不可用 · 文本阅读' : 'NO WEBGL · 文本阅读'
            }
            onSelectModule={(moduleId) => viewer.selectModule(moduleId)}
          />
        ) : (
          <StageSlot
            viewer={viewer}
            lane={lane}
            sceneId={snapshot.scene.id}
            optionsKey={snapshot.optionsKey}
            reducedMotion={snapshot.reducedMotion}
          />
        )}
      </div>
      <div className="imv-lane__foot">
        <span className="imv-lane__fact" data-tone={factTone} title={fact?.detail ?? lane.note}>
          {factStatus}
        </span>
        <button
          type="button"
          className="imv-lane__reset"
          onClick={() => viewer.resetLaneCamera(lane.id)}
          aria-label={`重置${lane.label}视角`}
        >
          视角
        </button>
      </div>
    </article>
  );
}

function Transport({
  viewer,
  snapshot,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
}) {
  const { playback, scenario, step } = snapshot;
  const stepCount = scenario.steps.length;
  const canPlay = stepCount > 1;
  const percent =
    playback.duration > 0
      ? Math.max(0, Math.min(100, (playback.time / playback.duration) * 100))
      : 0;
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  if (!speeds.includes(playback.speed)) {
    speeds.push(playback.speed);
    speeds.sort((a, b) => a - b);
  }

  return (
    <div className="imv-transport">
      <div className="imv-transport__meta">
        <span className="imv-step-count">
          <strong>{String(snapshot.state.stepIndex + 1).padStart(2, '0')}</strong>{' '}
          / {String(stepCount).padStart(2, '0')} · {step.label}
        </span>
        <span className="imv-transport__note">
          阅读时间，不是实测耗时
        </span>
        <span className="imv-transport__clock" aria-hidden="true">
          {formatReadingTime(playback.time)} /{' '}
          {formatReadingTime(playback.duration)}
        </span>
      </div>

      <div className="imv-transport__rail" role="group" aria-label="阅读步骤">
        <button
          type="button"
          className="imv-stepnav"
          onClick={() => viewer.stepBy(-1)}
          aria-label="上一步"
          title="上一步（←）"
          disabled={snapshot.state.stepIndex === 0}
        >
          ←
        </button>
        <div className="imv-steps">
          {scenario.steps.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              className="imv-step"
              aria-pressed={index === snapshot.state.stepIndex}
              aria-current={index === snapshot.state.stepIndex ? 'step' : undefined}
              title={candidate.title}
              onClick={() => viewer.setStep(index)}
            >
              <span className="imv-step__num">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="imv-step__label">{candidate.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="imv-stepnav"
          onClick={() => viewer.stepBy(1)}
          aria-label="下一步"
          title="下一步（→）"
          disabled={snapshot.state.stepIndex >= stepCount - 1}
        >
          →
        </button>
      </div>

      <div className="imv-playback">
        {snapshot.state.moduleId ? (
          <button type="button" className="imv-button" onClick={() => { viewer.selectModule(null); viewer.resetCamera(); }}>返回整体</button>
        ) : null}
        <button
          type="button"
          className="imv-button imv-playback__toggle"
          onClick={() => (playback.playing ? viewer.pause() : viewer.play())}
          disabled={!canPlay}
          aria-label={playback.playing ? '暂停自动阅读' : '开始自动阅读'}
        >
          {playback.playing ? 'Ⅱ 暂停' : '▶ 播放'}
        </button>

        <div className="imv-playback__time">
          <span className="imv-timecode">
            {formatReadingTime(playback.time)}
          </span>
          <input
            className="imv-scrub"
            type="range"
            min={0}
            max={Math.max(0.1, playback.duration)}
            step={0.02}
            value={Math.min(playback.time, playback.duration)}
            style={{ '--imv-fill': `${percent}%` } as CSSProperties}
            onChange={(event) => viewer.seek(Number(event.currentTarget.value))}
            aria-label="阅读时间"
            aria-valuetext={`${formatReadingTime(playback.time)} / ${formatReadingTime(playback.duration)}`}
          />
          <span className="imv-timecode imv-timecode--total">
            {formatReadingTime(playback.duration)}
          </span>
        </div>

        <label className="imv-speed">
          <span>倍速</span>
          <select
            className="imv-select imv-speed__select"
            value={String(playback.speed)}
            onChange={(event) => viewer.setSpeed(Number(event.currentTarget.value))}
            aria-label="播放倍速"
          >
            {speeds.map((speed) => (
              <option key={speed} value={String(speed)}>
                {speed}×
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="imv-button imv-button--quiet imv-playback__reset"
          onClick={() => viewer.setStep(0)}
        >
          重置
        </button>
      </div>

      <div
        className="imv-progress"
        role="progressbar"
        aria-label="阅读进度"
        aria-valuemin={0}
        aria-valuemax={Math.round(playback.duration * 10) / 10}
        aria-valuenow={Math.round(playback.time * 10) / 10}
        aria-valuetext={`${formatReadingTime(playback.time)} / ${formatReadingTime(playback.duration)}`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function StageDeck({
  viewer,
  snapshot,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
}) {
  const lanes = lanesFor(snapshot);
  return (
    <section className="imv-visual" aria-label="三维场景与阅读控制">
      <Transport viewer={viewer} snapshot={snapshot} />
      <div className="imv-lanes" data-count={String(lanes.length)}>
        {lanes.map((lane) => (
          <LanePanel
            key={lane.id}
            viewer={viewer}
            snapshot={snapshot}
            lane={lane}
          />
        ))}
      </div>
      {snapshot.scene.instructions ? (
        <p className="imv-caption">{snapshot.scene.instructions}</p>
      ) : null}
    </section>
  );
}
