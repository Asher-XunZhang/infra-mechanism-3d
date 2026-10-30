import { moduleIdsForScene } from '../state';
import type { SceneReadout } from '../types';
import { SectionHead, SourceList } from './common';
import { ReadoutPanel } from './Readout';
import type { ViewerUiController, ViewerUiSnapshot } from './types';

function StepGuide({ snapshot }: { snapshot: ViewerUiSnapshot }) {
  const { step, scenario } = snapshot;
  const facts = scenario.steps.length
    ? snapshot.scene.lanes
        .map((lane) => {
          const fact = step.laneFacts?.[lane.id];
          return fact ? { lane, fact } : null;
        })
        .filter(
          (entry): entry is NonNullable<typeof entry> => Boolean(entry),
        )
    : [];

  return (
    <section className="imv-guide" aria-label="当前阅读步骤">
      <SectionHead
        index="01"
        label="READING STEP"
        meta={scenario.label}
      />
      <p className="imv-guide__kicker">
        第 {String(snapshot.state.stepIndex + 1).padStart(2, '0')} 步 /{' '}
        {String(snapshot.stepCount).padStart(2, '0')}
      </p>
      <h3 className="imv-guide__title">{step.title}</h3>
      <p className="imv-guide__summary">{step.summary}</p>
      {step.points?.length ? (
        <ul className="imv-guide__points">
          {step.points.map((point, index) => (
            <li key={`${step.id}-point-${index}`}>{point}</li>
          ))}
        </ul>
      ) : null}
      {facts.length ? (
        <div className="imv-facts">
          {facts.map(({ lane, fact }) => (
            <div
              key={lane.id}
              className="imv-fact"
              data-tone={fact.tone}
              data-lane={lane.id}
            >
              <div className="imv-fact__head">
                <span className="imv-fact__lane">{lane.version}</span>
                <span className="imv-fact__status">{fact.status}</span>
              </div>
              <p>{fact.detail}</p>
            </div>
          ))}
        </div>
      ) : null}
      {scenario.note ? (
        <p className="imv-guide__note">{scenario.note}</p>
      ) : null}
    </section>
  );
}

function Dossier({
  viewer,
  snapshot,
  index,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  index: string;
}) {
  const { pack, scene, state } = snapshot;
  const moduleId = state.moduleId;
  const module = moduleId ? pack.modules[moduleId] : undefined;

  if (!module) {
    const sceneModuleIds = new Set(moduleIdsForScene(scene));
    return (
      <section className="imv-dossier" aria-label="模块档案">
        <SectionHead index={index} label="NODE DOSSIER" meta="可下钻" />
        <h3 className="imv-dossier__empty-title">选一个节点，读它的边界</h3>
        <p className="imv-dossier__empty-copy">
          点击三维节点、场景标签，或下方“模块索引”。键盘可用 Tab
          遍历，方向键在索引中移动。
        </p>
        <div className="imv-groupcards">
          {pack.groups.map((group) => {
            const count = Object.values(pack.modules).filter(
              (candidate) =>
                candidate.groupId === group.id && sceneModuleIds.has(candidate.id),
            ).length;
            return (
              <div
                key={group.id}
                className="imv-groupcard"
                data-kind={group.kind}
              >
                <span className="imv-groupcard__label">{group.label}</span>
                <span className="imv-groupcard__count">{count} 个节点</span>
                <p>{group.detail}</p>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  const group = pack.groups.find(
    (candidate) => candidate.id === module.groupId,
  );

  return (
    <section className="imv-dossier" aria-label={`${module.title} 模块档案`}>
      <SectionHead
        index={index}
        label="NODE DOSSIER"
        meta={group?.label ?? '模块'}
      />
      <div className="imv-dossier__title" data-accent={module.accent}>
        <span className="imv-orb" aria-hidden="true" />
        <div>
          <p className="imv-kicker">{module.directory}</p>
          <h3>{module.title}</h3>
          <code>{module.name}</code>
        </div>
        <button
          type="button"
          className="imv-close"
          onClick={() => viewer.selectModule(null)}
          aria-label="关闭节点档案"
        >
          ×
        </button>
      </div>
      <p className="imv-dossier__summary">{module.summary}</p>
      <div className="imv-dossier__block">
        <h4>为什么重要</h4>
        <p>{module.why}</p>
      </div>
      <div className="imv-dossier__block">
        <h4>源码行为</h4>
        <p>{module.action}</p>
      </div>
      <div className="imv-dossier__block">
        <h4>对象 / 数据</h4>
        <ul>
          {module.objects.map((item, itemIndex) => (
            <li key={`${module.id}-object-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="imv-dossier__block imv-dossier__block--boundary">
        <h4>边界 / 别混淆</h4>
        <ul>
          {module.boundaries.map((item, itemIndex) => (
            <li key={`${module.id}-boundary-${itemIndex}`}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="imv-dossier__block">
        <h4>固定源码</h4>
        <SourceList
          sourceIds={module.sourceIds}
          anchors={pack.sourceAnchors}
          detailed
          empty="这个模块没有单独列出的源码锚点。"
        />
      </div>
    </section>
  );
}

export function Inspector({
  viewer,
  snapshot,
  readout,
}: {
  viewer: ViewerUiController;
  snapshot: ViewerUiSnapshot;
  readout: SceneReadout | null;
}) {
  return (
    <aside className="imv-inspector" aria-label="步骤与模块档案">
      <StepGuide snapshot={snapshot} />
      {readout ? <ReadoutPanel readout={readout} /> : null}
      <Dossier
        viewer={viewer}
        snapshot={snapshot}
        index={readout ? '03' : '02'}
      />
    </aside>
  );
}
