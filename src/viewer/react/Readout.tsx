import type { SceneReadout } from '../types';
import { SectionHead } from './common';

/**
 * Generic content-owned readout. A scene decides which stats and rows are
 * meaningful; this component only gives them a consistent, accessible shape.
 */
export function ReadoutPanel({ readout }: { readout: SceneReadout }) {
  return (
    <section className="imv-readout" aria-label="场景读数">
      <SectionHead
        index="02"
        label="SCENE READOUT"
        meta={readout.pending ? '等待采样' : '当前读数'}
      />
      <p className="imv-readout__eyebrow">{readout.eyebrow}</p>
      <h3 className="imv-readout__title">{readout.title}</h3>
      {readout.detail ? (
        <p className="imv-readout__detail">{readout.detail}</p>
      ) : null}
      {readout.stats.length ? (
        <dl className="imv-readout__stats">
          {readout.stats.map((stat, index) => (
            <div
              key={`${stat.label}-${index}`}
              className="imv-readout__stat"
              data-tone={stat.tone ?? 'neutral'}
            >
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {readout.groups.length ? (
        <div className="imv-readout__groups">
          {readout.groups.map((group) => (
            <section
              key={group.id}
              className="imv-readout__group"
              aria-label={group.title}
            >
              <div className="imv-readout__group-head">
                <h4>{group.title}</h4>
                {group.note ? <span>{group.note}</span> : null}
              </div>
              {group.stats?.length ? (
                <dl className="imv-readout__stats">
                  {group.stats.map((stat, index) => (
                    <div
                      key={`${stat.label}-${index}`}
                      className="imv-readout__stat"
                      data-tone={stat.tone ?? 'neutral'}
                    >
                      <dt>{stat.label}</dt>
                      <dd>{stat.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {group.rows?.length ? (
                <div className="imv-readout__rows">
                  {group.rows.map((row) => (
                    <div
                      key={row.id}
                      className="imv-readout__row"
                      data-tone={row.tone ?? 'neutral'}
                    >
                      <div className="imv-readout__row-head">
                        <strong>{row.label}</strong>
                        {row.meta ? <span>{row.meta}</span> : null}
                      </div>
                      {row.detail ? <p>{row.detail}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <p className="imv-empty imv-empty--small">
          这一步没有额外的场景读数。
        </p>
      )}
    </section>
  );
}
