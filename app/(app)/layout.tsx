import { env } from '@/lib/env'
import { requireGateSession } from '@/lib/session/require-gate'
import { leaveAction } from '../(auth)/enter/actions'

/**
 * The authenticated shell.
 *
 * THE CHECK BELOW IS THE CONTROL, NOT THE MIDDLEWARE. A layout guard alone would be wrong
 * too: layouts do not re-render on client-side navigation, so a layout that passes once can
 * silently stop running. Every page and route handler under this tree calls the same guard
 * for itself, and this call is the outer belt on top of that.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireGateSession('/')

  const e = env()
  const environment = e.APP_ENV ?? e.NODE_ENV
  const commit = e.GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="shell__bar">
        <p className="shell__brand">
          ONLYSOURCE <span>foundation shell</span>
        </p>
        <span className="pill pill--attention">{environment}</span>
        <span className="shell__spacer" />
        <span className="mono muted" title="Build identity">
          {commit}
        </span>
        <form action={leaveAction}>
          <button className="button button--quiet" type="submit">
            Leave
          </button>
        </form>
      </header>

      <main className="shell__main" id="main">
        {children}
      </main>

      <footer className="shell__foot">
        Pre-release environment. No customer data, no tenant, no accounts yet. Everything shown
        here is computed by this build or read from its own configuration.
      </footer>
    </div>
  )
}
