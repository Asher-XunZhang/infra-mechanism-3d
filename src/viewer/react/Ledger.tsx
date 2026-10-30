import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { moduleIdsForScene } from '../state';
import type { ViewerPack } from '../types';
import {
  ExternalLink,
  SectionHead,
  SourceList,
  conditionIcon,
  conditionLabel,
} from './common';
import type { ViewerUiController, ViewerUiSnapshot } from './types';

const PROJECT_REPOSITORY = 'https://github.com/Asher-XunZhang/infra-mechanism-3d';

function ConditionsPanel({
  snapshot,
  index,
}: {
  snapshot: ViewerUiSnapshot;
  index: string;
}) {
  const conditions = snapshot.scenario.conditions ?? [];
  return (
    <section className="imv-panel" aria-label="前置条件">
      <SectionHead
        index={index}
        label="CONDITIONS"
        meta={`${conditions.length} 项`}
      />
      {conditions.length ? (
        <ol className="imv-conditions">
          {conditions.map((condition) => (
            <li
              key={condition.id}
              className="imv-condition"
              data-status={condition.status}
            >
              <span className="imv-condition__glyph" aria-hidden="true">
                {conditionIcon(condition.status)}
              </span>
              <div>
                <strong>{condition.label}</strong>
                <span className="imv-condition__status">
                  {conditionLabel(condition.status)}
                </span>
                <p>{condition.detail}</p>
                {condition.sourceIds ? (
                  <SourceList
                    sourceIds={condition.sourceIds}
                    anchors={snapshot.pack.sourceAnchors}
                    detailed={false}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="imv-empty">
          这个场景没有额外的运行时门槛；它是结构阅读地图，不宣称一次真实请求的耗时。
        </p>
      )}
    </section>
  );
}

function ChangesPanel({
  viewer,
  snapshot,
  index,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  index: string;
}) {
  const changes = snapshot.scenario.changes ?? [];
  const [open, setOpen] = useState(
    snapshot.scene.mode === 'compare' && changes.length > 0,
  );
  useEffect(() => {
    setOpen(snapshot.scene.mode === 'compare' && changes.length > 0);
  }, [snapshot.scene.id, snapshot.scenario.id, snapshot.scene.mode, changes.length]);
  return (
    <section className="imv-panel" aria-label="版本差异">
      <SectionHead
        index={index}
        label="VERSION DELTA"
        meta={changes.length ? `${changes.length} 项变化` : '单版本'}
      />
      {changes.length ? (
        <details
          className="imv-changes"
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>对照变更模块与 before / after</summary>
          <div className="imv-changes__list">
            {changes.map((change) => {
              const module = snapshot.pack.modules[change.moduleId];
              return (
                <div
                  key={change.moduleId}
                  className="imv-change"
                  data-tone={change.tone}
                >
                  <button
                    type="button"
                    className="imv-change__module"
                    onClick={() => viewer.selectModule(change.moduleId)}
                  >
                    {module?.title ?? change.label}
                  </button>
                  <span className="imv-change__label">{change.label}</span>
                  <div className="imv-change__states">
                    <span>
                      <em>旧</em>
                      {change.oldState}
                    </span>
                    <span>
                      <em>新</em>
                      {change.newState}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      ) : (
        <p className="imv-empty">
          普通链路只使用一个固定源码基线；版本差异集中在“PD
          角色切换”场景，不把主地图 commit 与前缀对比混用。
        </p>
      )}
    </section>
  );
}

function ModuleIndexPanel({
  viewer,
  snapshot,
  index,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  index: string;
}) {
  const sceneModuleIds = new Set(moduleIdsForScene(snapshot.scene));
  const groups = snapshot.pack.groups
    .map((group) => ({
      group,
      modules: Object.values(snapshot.pack.modules).filter(
        (module) =>
          module.groupId === group.id && sceneModuleIds.has(module.id),
      ),
    }))
    .filter((entry) => entry.modules.length > 0);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const direction =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!direction) {
      return;
    }
    const container = event.currentTarget.closest('.imv-index');
    if (!container) {
      return;
    }
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.imv-module'),
    );
    const current = buttons.indexOf(event.currentTarget);
    if (current < 0) {
      return;
    }
    event.preventDefault();
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  };

  return (
    <section className="imv-panel imv-panel--modules" aria-label="模块索引">
      <SectionHead
        index={index}
        label="MODULE INDEX"
        meta={`${sceneModuleIds.size} 个模块`}
      />
      <p className="imv-panel__hint">
        Tab 进入，方向键移动，Enter / Space 打开档案。
      </p>
      <div className="imv-index">
        {groups.map(({ group, modules }) => (
          <div key={group.id} className="imv-index__group">
            <h4>{group.label}</h4>
            <div className="imv-index__buttons">
              {modules.map((module) => (
                <button
                  key={module.id}
                  type="button"
                  className="imv-module"
                  data-accent={module.accent}
                  aria-pressed={module.id === snapshot.state.moduleId}
                  title={module.summary}
                  onClick={() => viewer.selectModule(module.id)}
                  onKeyDown={handleKeyDown}
                >
                  <span className="imv-module__title">{module.title}</span>
                  <span className="imv-module__name">{module.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {!groups.length ? (
          <p className="imv-empty">这个场景没有可下钻的模块。</p>
        ) : null}
      </div>
    </section>
  );
}

function EvidencePanel({
  snapshot,
  index,
}: {
  snapshot: ViewerUiSnapshot;
  index: string;
}) {
  const stepSources = snapshot.step.sourceIds ?? [];
  const moduleSources = snapshot.state.moduleId
    ? (snapshot.pack.modules[snapshot.state.moduleId]?.sourceIds ?? [])
    : [];
  const sources = [...new Set([...stepSources, ...moduleSources])];
  return (
    <section className="imv-panel" aria-label="源码证据">
      <SectionHead
        index={index}
        label="SOURCE EVIDENCE"
        meta={`${sources.length} 个锚点`}
      />
      <p className="imv-panel__hint">
        当前步骤与选中模块的固定源码位置；只读静态核对，不运行 SGLang。
      </p>
      <SourceList
        sourceIds={sources}
        anchors={snapshot.pack.sourceAnchors}
        detailed
      />
    </section>
  );
}

export function LowerLedger({
  viewer,
  snapshot,
  sectionStart,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  sectionStart: number;
}) {
  // The section numbers form one reading sequence. If a scene supplies a
  // readout it takes 02, shifting the ledger by one.
  return (
    <div className="imv-lower">
      <div className="imv-lower__grid">
        <ConditionsPanel snapshot={snapshot} index={String(sectionStart)} />
        <ChangesPanel
          viewer={viewer}
          snapshot={snapshot}
          index={String(sectionStart + 1)}
        />
        <ModuleIndexPanel
          viewer={viewer}
          snapshot={snapshot}
          index={String(sectionStart + 2)}
        />
        <EvidencePanel
          snapshot={snapshot}
          index={String(sectionStart + 3)}
        />
      </div>
    </div>
  );
}

export function ViewerFooter({ pack }: { pack: ViewerPack }) {
  const notes = pack.notes.slice(0, 3);
  return (
    <footer className="imv-foot">
      <div className="imv-foot__mark">
        <span>NOTICE</span>
        <strong>{pack.title}</strong>
      </div>
      <ul className="imv-foot__notes">
        {notes.map((note, index) => (
          <li key={`note-${index}`}>{note}</li>
        ))}
      </ul>
      <div className="imv-foot__legal">
        <span>只读源码证据 · 非性能实测</span>
        <span>MIT · Asher-XunZhang</span>
        <ExternalLink href={pack.repository} className="imv-foot__link">
          sgl-project/sglang ↗
        </ExternalLink>
        <ExternalLink href={PROJECT_REPOSITORY} className="imv-foot__link">
          仓库与证据说明 ↗
        </ExternalLink>
      </div>
    </footer>
  );
}
