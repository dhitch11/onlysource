import type { Metadata } from 'next'
import { configReport } from '@/lib/env'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import {
  AWARD_CUTOFF,
  CUTOFF_PROVENANCE,
  CUTOFF_SWEEPS,
  deadlineDisclosure,
  formatCutoffLocal,
  nextCutoffFireFrom,
} from '@/lib/time/cutoff'

export const metadata: Metadata = { title: 'Workspace · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * The empty authenticated workspace.
 *
 * IT IS EMPTY AND IT SAYS SO. There is no placeholder requirement, no sample score, no
 * greyed-out control that would work later. Everything on this page is either computed by
 * this build or read from this build's own configuration, and every number carries the file
 * it came from.
 *
 * The award clock is here because it is the one thing the foundation genuinely owns and
 * genuinely knows on day one, and because rendering it exercises the labeled-unconfirmed
 * state that gate R1.2 requires of every customer-facing deadline.
 */
export default async function WorkspacePage() {
  await requireGateSession('/')

  const report = configReport()
  const fire = nextCutoffFireFrom(systemClock)
  const disclosure = deadlineDisclosure(fire.instantMs)

  return (
    <div className="stack">
      <section className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <h1 className="h1">The foundation is up. There is nothing in it yet.</h1>
        <p className="lede">
          This shell exists so the other seven lanes have somewhere to build. It holds no
          requirements, no parts, no documents and no accounts, because none of those are wired
          yet. When they are, they appear here as real records or as a named empty state, never
          as a sample.
        </p>
      </section>

      {/* --------------------------------------------------------- the clock */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">Next award cutoff</h2>
        </div>
        <div className="card__body stack stack--tight">
          {disclosure.unconfirmed ? (
            <p className="banner banner--attention" role="note">
              <span>
                <strong>Unconfirmed reading.</strong> {disclosure.qualifier}
              </span>
            </p>
          ) : null}

          <dl className="rows">
            <div className="row">
              <dt className="row__key">Next fire</dt>
              <dd className="row__val mono">{formatCutoffLocal(fire.instantMs)}</dd>
            </div>
            <div className="row">
              <dt className="row__key">As a UTC instant</dt>
              <dd className="row__val mono">{new Date(fire.instantMs).toISOString()}</dd>
            </div>
            <div className="row">
              <dt className="row__key">Staged sweeps</dt>
              <dd className="row__val mono">
                {CUTOFF_SWEEPS.map((s) => (
                  <div key={s.key}>
                    {s.key}
                    {'  '}
                    {new Date(fire.sweeps[s.key]).toISOString()}
                  </div>
                ))}
              </dd>
            </div>
            <div className="row">
              <dt className="row__key">Rule</dt>
              <dd className="row__val">
                {String(AWARD_CUTOFF.localTime.hour).padStart(2, '0')}:
                {String(AWARD_CUTOFF.localTime.minute).padStart(2, '0')} wall clock in{' '}
                <span className="mono">{AWARD_CUTOFF.zone}</span>, skipping weekends and observed
                federal holidays. Stored as a local time plus a zone, never as a fixed offset.
              </dd>
            </div>
          </dl>

          <details>
            <summary className="label" style={{ cursor: 'pointer' }}>
              Where this number came from, and why it is labeled unconfirmed
            </summary>
            <div className="stack--tight" style={{ paddingTop: 'var(--s-2)' }}>
              <p className="muted">
                <strong>What it is.</strong> The deadline the automated award program starts
                working from. Everything in this product that has to file something is bound by
                it.
              </p>
              <p className="muted">
                <strong>Source.</strong> <span className="mono">{CUTOFF_PROVENANCE.source}</span>,
                which states it as: {CUTOFF_PROVENANCE.statedAs}. Computed by{' '}
                <span className="mono">lib/time/cutoff.ts</span>, which is the only copy of this
                constant in the codebase. Display and scheduling both read it.
              </p>
              <p className="muted">
                <strong>Why it is labeled.</strong> Nobody has yet recorded a citation from DLA
                primary text. Until somebody does, this is our working reading and it is marked
                as one. Specifically:
              </p>
              <ul className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
                {CUTOFF_PROVENANCE.contested.map((item) => (
                  <li className="muted" key={item}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </section>

      {/* ---------------------------------------------------- what is wired */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">What is connected</h2>
        </div>
        <div className="card__body">
          <dl className="rows">
            {Object.entries(report.subsystems).map(([key, value]) => (
              <div className="row" key={key}>
                <dt className="row__key">
                  <span className="mono">{key}</span>
                </dt>
                <dd className="row__val">
                  <span
                    className={`pill ${value.status === 'configured' ? 'pill--ok' : 'pill--off'}`}
                  >
                    {value.status === 'configured' ? 'connected' : 'not connected'}
                  </span>{' '}
                  <span className="muted">{value.detail}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ------------------------------------------------- what is not built */}
      <section className="card">
        <div className="card__head">
          <h2 className="card__title">What is not built yet</h2>
        </div>
        <div className="card__body stack stack--tight">
          <p className="muted">
            Listed so nobody has to guess, and so nothing here is quietly implied to exist. Each
            line is owned by another lane.
          </p>
          <dl className="rows">
            {[
              ['Identity and accounts', 'Sign-up, sign-in, invitations, roles, MFA. T1, next.'],
              ['Tenancy', 'The database, row level security, the audit spine. T1, next.'],
              ['The daily requirement feed', 'Ingestion, the catalog, enrichment. T2.'],
              ['Scoring and the board', 'The engine and its explanations. T3.'],
              ['Monopoly map and capability match', 'Intelligence surfaces. T4.'],
              ['Document packets and compliance', 'Assembly and traceability. T5.'],
              ['Automation and supplier pursuit', 'Workflows, email, alerts. T6.'],
              ['Admin console and the public API', 'Support tooling and integrations. T7.'],
              ['The design system', 'Components, information affordances, onboarding. T8.'],
            ].map(([name, detail]) => (
              <div className="row" key={name}>
                <dt className="row__key">{name}</dt>
                <dd className="row__val muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  )
}
