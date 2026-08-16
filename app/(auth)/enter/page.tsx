import type { Metadata } from 'next'
import type { Route } from 'next'
import { redirect } from 'next/navigation'
import { configReport } from '@/lib/env'
import { readGateVerdict } from '@/lib/session/require-gate'
import { enterAction } from './actions'

export const metadata: Metadata = { title: 'Enter · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

type Search = { e?: string; m?: string; next?: string }

/**
 * Error copy.
 *
 * Deliberately says the same thing for a wrong phrase whatever the reason, so this page is
 * not an oracle. It is specific about what the person should DO, because a dead end with no
 * next step is how somebody gives up on a tool at 2:45 PM.
 */
function messageFor(code: string | undefined, minutes: string | undefined) {
  switch (code) {
    case 'bad':
      return {
        kind: 'danger' as const,
        title: 'That is not the access phrase for this environment.',
        detail: 'Check for a trailing space. If you do not have the phrase, ask the conductor.',
      }
    case 'locked':
      return {
        kind: 'danger' as const,
        title: `Too many attempts from this address.`,
        detail: `Try again in ${minutes ?? 'a few'} minutes. Nothing is broken and no account is disabled.`,
      }
    case 'unconfigured':
      return {
        kind: 'attention' as const,
        title: 'This environment has no access phrase configured, so it is closed to everyone.',
        detail:
          'This is the fail-closed path working as designed. Nothing is exposed and nobody is locked out by mistake. The conductor needs to set PREVIEW_GATE_SECRET and PREVIEW_GATE_PASSWORD.',
      }
    default:
      return null
  }
}

export default async function EnterPage({
  searchParams,
}: {
  searchParams: Promise<Search>
}) {
  const params = await searchParams
  const verdict = await readGateVerdict()
  if (verdict.valid) {
    const target =
      params.next && params.next.startsWith('/') && !params.next.startsWith('//')
        ? params.next
        : '/'
    redirect(target as Route)
  }

  const report = configReport()
  const gateConfigured = report.subsystems.pre_release_gate?.status === 'configured'
  const message = messageFor(params.e, params.m)
  const next = params.next && params.next.startsWith('/') && !params.next.startsWith('//')
    ? params.next
    : '/'

  return (
    <main className="entry">
      <div className="entry__panel stack stack--tight">
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          <p className="h1">ONLYSOURCE</p>
          <p className="lede">
            Operator workspace for defense parts dealers. This environment is not open to the
            public and holds no customer data yet.
          </p>
        </div>

        {message ? (
          <div className={`banner banner--${message.kind}`} role="alert">
            <span>
              <strong>{message.title}</strong> {message.detail}
            </span>
          </div>
        ) : null}

        <div className="card">
          <div className="card__body">
            <form action={enterAction} className="stack stack--tight">
              <input type="hidden" name="next" value={next} />
              {/*
                The email field is rendered whether or not an account exists yet, and that is
                deliberate. Hiding it while the break-glass door is open would make the sign-in
                form CHANGE SHAPE the moment somebody sets the first password, which is exactly
                when a person is least able to tell a product change from a broken page. The
                server decides which door applies; the form asks for both halves either way.
              */}
              <div className="field">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  className="input"
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  aria-describedby="signin-hint"
                  disabled={!gateConfigured}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  className="input"
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-describedby="signin-hint"
                  disabled={!gateConfigured}
                />
                <p className="hint" id="signin-hint">
                  Sign in with your ONLYSOURCE account. Your role decides what you can reach, and
                  it is checked on the server on every request.
                </p>
              </div>
              <div>
                <button className="button" type="submit" disabled={!gateConfigured}>
                  {gateConfigured ? 'Enter' : 'Closed: no phrase configured'}
                </button>
              </div>
            </form>
          </div>
        </div>

        <details className="card">
          {/*
            INFORMATION AFFORDANCE. T8 owns the real <ExplainButton>. This is a native
            <details>, which is focusable, keyboard operable, screen-reader announced and
            never hover-only, so the requirement is met in substance while the component
            slot stays T8's to fill. Do not build a bespoke one here.
          */}
          <summary className="card__head" style={{ cursor: 'pointer' }}>
            <span className="card__title">What is this gate, and what does it protect</span>
          </summary>
          <div className="card__body stack stack--tight">
            <p className="muted">
              <strong>What it is.</strong> A single shared phrase that stands in front of a
              pre-release environment while the real identity layer is being built.
            </p>
            <p className="muted">
              <strong>How it works.</strong> The phrase is compared on the server in constant
              time. A match issues a signed, HttpOnly cookie that expires after 12 hours with no
              sliding renewal. The pages behind it are never sent to your browser first and
              hidden with styling. If the phrase is wrong, the server renders this page instead.
            </p>
            <p className="muted">
              <strong>Why it matters.</strong> A gate that hides content the server already sent
              protects nothing. This one refuses at the server, and it refuses by default: with
              no phrase configured, every request is denied rather than allowed.
            </p>
          </div>
        </details>
      </div>
    </main>
  )
}
