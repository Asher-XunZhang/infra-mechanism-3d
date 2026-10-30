import { useSyncExternalStore } from 'react';
import type { LaneMode } from '../types';
import { CommitLinks, ExternalLink } from './common';
import { Inspector } from './Inspector';
import { LowerLedger, ViewerFooter } from './Ledger';
import { readSceneReadout } from './readout-data';
import { StageDeck } from './StageDeck';
import type { ViewerUiController } from './types';

function TopBar({
  viewer,
  snapshot,
}: {
  viewer: ViewerUiController;
  snapshot: ReturnType<ViewerUiController['getSnapshot']>;
}) {
  const { pack, scene } = snapshot;
  return (
    <header className="imv-bar">
      <div className="imv-brand">
        <span className="imv-brand__mark" aria-hidden="true">
          IM
        </span>
        <div className="imv-brand__copy">
          <strong>机制图</strong>
          <span>INFRA MECHANISM VIEWER</span>
        </div>
      </div>
      <nav className="imv-nav" aria-label="场景切换">
        {pack.scenes.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            className="imv-nav__button"
            aria-pressed={candidate.id === scene.id}
            onClick={() => viewer.setScene(candidate.id)}
          >
            <span className="imv-nav__num">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>{candidate.navLabel}</span>
          </button>
        ))}
      </nav>
      <div className="imv-bar__meta">
        <span className="imv-bar__flag">固定源码</span>
        <span>审阅 {pack.reviewDate}</span>
        <span className="imv-bar__keys">
          ← → 步进 · 空格 播放 · C 视角
        </span>
      </div>
    </header>
  );
}

function SceneContext({
  snapshot,
}: {
  snapshot: ReturnType<ViewerUiController['getSnapshot']>;
}) {
  const { scene } = snapshot;
  const provenance = scene.provenance;
  return (
    <details className="imv-context-panel">
      <summary><strong>{scene.title}</strong><span>基线与说明 ▾</span></summary>
      <div className="imv-context">
      <div className="imv-context__copy">
        <p className="imv-kicker">{scene.kicker}</p>
        <h2>{scene.title}</h2>
        <p className="imv-description">{scene.description}</p>
      </div>
      <div className="imv-provenance">
        <div className="imv-provenance__row">
          <span>版本 / commit</span>
          <CommitLinks
            repository={provenance.repository}
            commit={provenance.commit}
          />
        </div>
        <div className="imv-provenance__row">
          <span>{provenance.label || '固定源码'}</span>
          <p>{provenance.scope}</p>
        </div>
        {provenance.reviewed ? (
          <div className="imv-provenance__row">
            <span>复读日期</span>
            <p>{provenance.reviewed}</p>
          </div>
        ) : null}
      </div>
      </div>
    </details>
  );
}

function Toolbar({
  viewer,
  snapshot,
}: {
  viewer: ViewerUiController;
  snapshot: ReturnType<ViewerUiController['getSnapshot']>;
}) {
  const { scene, scenario, state } = snapshot;
  const laneOptions: Array<{ id: LaneMode; label: string }> =
    scene.lanes.length > 1
      ? [
          { id: 'both', label: '双栏' },
          ...scene.lanes.slice(0, 2).map((lane, index) => ({
            id: (index === 0 ? 'left' : 'right') as LaneMode,
            label: lane.version,
          })),
        ]
      : [];
  const graphAssumption = scenario.conditions?.find(
    (condition) => condition.id === 'graph-headroom',
  );

  return (
    <div className="imv-tools">
      <div className="imv-tools__left">
        {scene.scenarios.length > 1 ? (
          <div className="imv-tools__group" role="group" aria-label="场景分支">
            <span className="imv-tools__label">分支</span>
            {scene.scenarios.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className="imv-tab"
                aria-pressed={candidate.id === scenario.id}
                onClick={() => viewer.setScenario(candidate.id)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        ) : null}

        {laneOptions.length ? (
          <div className="imv-tools__group" role="group" aria-label="版本视图">
            <span className="imv-tools__label">视图</span>
            {laneOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="imv-tab"
                data-lane-mode={option.id}
                aria-pressed={option.id === state.laneMode}
                onClick={() => viewer.setLaneMode(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {scene.options?.map((option) => {
          const id = `imv-option-${scene.id}-${option.id}`;
          return (
            <label key={option.id} className="imv-tool-option" htmlFor={id}>
              <span className="imv-tools__label">{option.label}</span>
              <select
                id={id}
                className="imv-select"
                value={state.options[option.id] ?? option.defaultValue}
                onChange={(event) =>
                  viewer.setOption(option.id, event.currentTarget.value)
                }
              >
                {option.values.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        {graphAssumption ? (
          <span className="imv-assumption" title={graphAssumption.detail}>
            Graph 余量 · {graphAssumption.status === 'assumed' ? '明确假设' : '已检查'}
          </span>
        ) : null}

        <span className="imv-tools__hint">
          拖拽旋转 · 滚轮缩放 · 点击 3D 节点或标签查看模块档案
        </span>
      </div>
      <div className="imv-tools__right">
        {scene.id !== 'mechanism' && snapshot.pack.scenes.some(item => item.id === 'mechanism') ? (
          <button type="button" className="imv-button imv-button--quiet" onClick={() => viewer.setScene('mechanism')}>深入请求与 KV 机制</button>
        ) : null}
        <button
          type="button"
          className="imv-button imv-button--quiet"
          onClick={() => viewer.resetCamera()}
        >
          ⌖ 视角复位
        </button>
        <ExternalLink
          href={snapshot.pack.repository}
          className="imv-tools__source"
        >
          源码仓 ↗
        </ExternalLink>
      </div>
    </div>
  );
}

export function ViewerApp({ viewer }: { viewer: ViewerUiController }) {
  const snapshot = useSyncExternalStore(
    viewer.subscribe,
    viewer.getSnapshot,
    viewer.getSnapshot,
  );
  const readout = readSceneReadout(snapshot);
  const sectionStart = readout ? 4 : 3;
  const liveText = `第 ${snapshot.state.stepIndex + 1} 步，共 ${snapshot.stepCount} 步：${snapshot.step.title}${snapshot.playback.playing ? '，自动阅读中' : ''}`;

  return (
    <section
      className="imv"
      data-scene={snapshot.scene.id}
      data-mode={snapshot.scene.mode}
      data-reduced-motion={String(snapshot.reducedMotion)}
      data-webgl={String(snapshot.webglSupported)}
      aria-label={`${snapshot.pack.title}机制阅读器`}
    >
      <TopBar viewer={viewer} snapshot={snapshot} />
      <SceneContext snapshot={snapshot} />
      <Toolbar viewer={viewer} snapshot={snapshot} />
      <div className="imv-main">
        <StageDeck viewer={viewer} snapshot={snapshot} />
        <Inspector viewer={viewer} snapshot={snapshot} readout={readout} />
      </div>
      <LowerLedger
        viewer={viewer}
        snapshot={snapshot}
        sectionStart={sectionStart}
      />
      <ViewerFooter pack={snapshot.pack} />
      <p className="imv-sr" role="status" aria-live="polite" aria-atomic="true">
        {liveText}
      </p>
    </section>
  );
}
