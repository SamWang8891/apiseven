// An object at a glance on its General tab: one line per other tab, each name linking to that tab,
// as a two-column list of facts (the service and stream route editors; the route and upstream
// editors have their own, with the same classes). Locked, it is the object's spec sheet.
import { Fragment, useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import './resources.css';

/** Mono values joined by commas, as one run of text that wraps between values, never inside one that fits a line. */
export function Mono({ values }: { values: string[] }) {
  return (
    <span className="mono">
      {values.map((value, i) => (
        <Fragment key={i}>
          {i > 0 && ', '}
          <span className="res-mono__value">{value}</span>
        </Fragment>
      ))}
    </span>
  );
}

/** Facts on one line, separated by dots. */
export function Parts({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="res-overview__parts">
      {parts.map((part, i) => (
        <span key={i} className="res-overview__part">
          {part}
        </span>
      ))}
    </span>
  );
}

export interface OverviewRow {
  /** The tab the row's name links to. */
  tab: string;
  label: string;
  value: ReactNode;
}

export function Overview({ title, rows }: { title: string; rows: OverviewRow[] }) {
  const id = useId();
  return (
    <section className="res-overview" aria-labelledby={id}>
      <h2 className="res-overview__title" id={id}>
        {title}
      </h2>
      <dl className="res-overview__list">
        {rows.map((row) => (
          <div key={row.tab} className="res-overview__row">
            <dt>
              <Link className="res-overview__link" to={`?tab=${row.tab}`} replace>
                {row.label}
              </Link>
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
