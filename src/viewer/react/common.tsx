import { Fragment, type ReactNode } from 'react';
import { sourceUrl } from '../state';
import type { Condition, SourceAnchor } from '../types';

function safeHttpUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : '#';
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={safeHttpUrl(href)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export function SectionHead({
  index,
  label,
  meta,
}: {
  index: string;
  label: string;
  meta?: ReactNode;
}) {
  return (
    <div className="imv-section-head">
      <span className="imv-section-num">{index}</span>
      <span>{label}</span>
      <span className="imv-section-rule" aria-hidden="true" />
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}

/** A fixed source commit, linked to the exact tree when it is a real SHA. */
export function CommitLinks({
  repository,
  commit,
}: {
  repository: string;
  commit: string;
}) {
  const parts = commit.split(/\s*\/\s*/).filter(Boolean);
  if (!parts.length) {
    return <span className="imv-empty imv-empty--small">未记录 commit</span>;
  }
  return (
    <div className="imv-commit">
      {parts.map((part, index) => (
        <Fragment key={`${part}-${index}`}>
          {index > 0 ? (
            <span className="imv-commit__sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {/^[0-9a-f]{7,40}$/i.test(part) ? (
            <ExternalLink
              href={`${repository}/tree/${part}`}
              className="imv-commit__link"
            >
              <code>{part.slice(0, 10)}</code>
            </ExternalLink>
          ) : (
            <code>{part}</code>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function SourceList({
  sourceIds,
  anchors,
  detailed = true,
  empty = '本步没有单独列出的源码锚点。',
}: {
  sourceIds: readonly string[] | undefined;
  anchors: Readonly<Record<string, SourceAnchor>>;
  detailed?: boolean;
  empty?: string;
}) {
  const list = (sourceIds ?? [])
    .map((id) => anchors[id])
    .filter((anchor): anchor is SourceAnchor => Boolean(anchor));
  if (!list.length) {
    return <p className="imv-empty imv-empty--small">{empty}</p>;
  }
  if (!detailed) {
    return (
      <div className="imv-source-inline">
        {list.slice(0, 5).map((anchor) => (
          <ExternalLink
            key={anchor.id}
            href={sourceUrl(anchor)}
            className="imv-source-link"
          >
            {anchor.label}
          </ExternalLink>
        ))}
      </div>
    );
  }
  return (
    <ul className="imv-sources">
      {list.map((anchor) => (
        <li key={anchor.id}>
          <div className="imv-source__head">
            <ExternalLink
              href={sourceUrl(anchor)}
              className="imv-source__symbol"
            >
              <code>{anchor.symbol}</code>
            </ExternalLink>
            <span>{anchor.label}</span>
          </div>
          <p>
            {anchor.path} · <code>{anchor.commit.slice(0, 10)}</code>
          </p>
          {anchor.note ? <p className="imv-source__note">{anchor.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function conditionLabel(status: Condition['status']): string {
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

export function conditionIcon(status: Condition['status']): string {
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
