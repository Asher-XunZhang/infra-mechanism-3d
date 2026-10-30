import type { LaneDefinition, ModuleDoc, ViewerStep } from '../types';

export interface FallbackStageProps {
  step: ViewerStep;
  lane: LaneDefinition;
  modules: readonly ModuleDoc[];
  reason: string;
  eyebrow: string;
  onSelectModule: (moduleId: string) => void;
}

/**
 * Text reading view for a lane with no usable WebGL context. Deliberately
 * self-contained so it can be rendered server-side in UI tests.
 */
export function FallbackStage({
  step,
  lane,
  modules,
  reason,
  eyebrow,
  onSelectModule,
}: FallbackStageProps) {
  return (
    <section className="imv-fallback" aria-label={`${lane.label} 文本阅读`}>
      <div className="imv-fallback__head">
        <span className="imv-kicker">{eyebrow}</span>
        <strong>{step.title}</strong>
      </div>
      <p className="imv-fallback__brief">{step.summary}</p>
      {step.points?.length ? (
        <ul className="imv-fallback__points">
          {step.points.map((point, index) => (
            <li key={`${step.id}-point-${index}`}>{point}</li>
          ))}
        </ul>
      ) : null}
      <p className="imv-fallback__note">{lane.note}</p>
      {reason ? <p className="imv-fallback__hint">{reason}</p> : null}
      <div className="imv-fallback__modules">
        {modules.map((module) => (
          <button
            key={module.id}
            type="button"
            className="imv-chip"
            data-accent={module.accent}
            onClick={() => onSelectModule(module.id)}
          >
            {module.title}
          </button>
        ))}
      </div>
      <p className="imv-fallback__hint">
        三维结构不可用，但上方步骤、下方条件与模块索引仍然可操作。
      </p>
    </section>
  );
}
