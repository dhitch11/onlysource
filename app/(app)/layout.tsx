import { env } from '@/lib/env'
import { requireGateSession } from '@/lib/session/require-gate'
import { leaveAction } from '../(auth)/enter/actions'
import { AppShell, type NavDestination } from '@/components/shell/AppShell'

/**
 * The authenticated shell.
 *
 * THE CHECK BELOW IS THE CONTROL, NOT THE MIDDLEWARE. A layout guard alone would be wrong
 * too: layouts do not re-render on client-side navigation, so a layout that passes once can
 * silently stop running. Every page and route handler under this tree calls the same guard
 * for itself, and this call is the outer belt on top of that.
 *
 * ---------------------------------------------------------------------------------------
 * @T1-FOUNDATION owns this file, the routing and the guard above. @T8-DESIGN owns the
 * chrome inside it and swapped the baseline bar for <AppShell> on 2026-08-13. The guard,
 * the env read and the leave action are UNTOUCHED and deliberately so: the presentation is
 * T8's, the control is T1's, and T8 does not edit a security path.
 * ---------------------------------------------------------------------------------------
 */

/**
 * THE NAVIGATION, AND THE HONEST PART OF IT.
 *
 * The BUILD-DIRECTIVE order is: Dashboard, The Board, Sales Hub, Hunter Mode, then a
 * separator, then Monopoly Map, Documents & POs, Suppliers, Admin & Users.
 *
 * FOUR OF THOSE ROUTES DO NOT EXIST YET, so they are not rendered. A nav item that 404s is
 * worse than one that is absent: it teaches an operator that the product is broken, and it
 * costs the same trust as a fabricated number. The rule in section 4.19 is that the nav
 * never shows a destination that fails on click, and an unbuilt route fails on click.
 *
 * OWNING LANE: WHEN YOUR ROUTE LANDS, FLIP YOUR LINE. It is a one-line change here and
 * nothing else. Do not add a nav entry before the route resolves.
 *
 *   The Board       app/(app)/board/page.tsx        @T3-ENGINE
 *   Monopoly Map    app/(app)/monopoly/page.tsx     @T4-INTELLIGENCE
 *   Suppliers       app/(app)/suppliers/page.tsx    @T4-INTELLIGENCE / @T5-DOCUMENTS
 *   Admin & Users   app/(app)/admin/page.tsx        @T7-ADMIN+API
 *
 * COUNTS: the approved console renders "The Board 213" and "Monopoly Map 1.2k". Those are
 * illustrative. `count` is left undefined here and the slot renders nothing, because there
 * is no ingest yet. A badge saying 213 when nothing has been ingested tells an operator
 * there are 213 rows to clear before 3:00 PM. Pass a real number or pass none.
 */
const DESTINATIONS: NavDestination[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/board', label: 'The Board', icon: 'board', permitted: false },
  { href: '/sales', label: 'Sales Hub', icon: 'sales', tag: 'CRM' },
  // Hunter Mode is its own emphasised module and routes into the Sales Hub engine, per the
  // BUILD-DIRECTIVE and the approved console. It is not a separate destination.
  //
  // NOTE ON ITS STATE: the approved console renders an amber "ON" tag here. That is a REAL
  // state (is the outreach engine running) and there is no engine wired yet, so no state is
  // rendered. @T6-AUTOMATION owns it; when the engine reports, pass `tag` from that reading
  // and never from a constant. T6's own Sales Hub already does the honest version of this
  // and shows "Not configured".
  { href: '/sales', label: 'Hunter Mode', icon: 'hunter', emphasised: true },
  { href: '/monopoly', label: 'Monopoly Map', icon: 'map', separatorBefore: true, permitted: false },
  { href: '/documents', label: 'Documents & POs', icon: 'documents' },
  { href: '/suppliers', label: 'Suppliers', icon: 'suppliers', permitted: false },
  // @T7 flipped this the moment app/(app)/admin/page.tsx landed. T8's rule holds and is the
  // reason it was false until now: a nav entry that 404s teaches an operator the product is
  // broken and costs the same trust as a fabricated number.
  { href: '/admin', label: 'Admin & Users', icon: 'admin' },
  // The design system reference. Internal, and it stays in the nav because it is how the
  // other seven lanes find the components without asking.
  { href: '/design', label: 'Design system', icon: 'design', separatorBefore: true },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireGateSession('/')

  const e = env()
  const environment = e.APP_ENV ?? e.NODE_ENV
  const commit = e.GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'

  return (
    <AppShell
      user={{ name: 'David Hitchman', role: 'Owner', title: 'ProjectX' }}
      org={{ name: 'ONLYSOURCE' }}
      destinations={DESTINATIONS}
      meta={
        <>
          <span className="pill pill--attention">{environment}</span>
          {/*
           * A VISIBLE LABEL, NOT A `title` TOOLTIP. R3/R4 ban the title attribute: it is
           * unreachable by keyboard, invisible to touch, and untestable.
           *
           * Deliberately NOT an <ExplainButton> either. That component carries a computation
           * record and a helpId from the help registry, and a build sha is neither computed
           * nor in need of a popover. Two visible words say it better than any affordance.
           */}
          <span className="mono muted">
            <span className="vh">Build identity: </span>
            build {commit}
          </span>
          {/* The compat spacer, not an inline style. No raw values in components is a rule
              this lane wrote, so it applies to this lane first. */}
          <span className="shell__spacer" />
          <form action={leaveAction}>
            <button className="button button--quiet" type="submit">
              Leave
            </button>
          </form>
        </>
      }
    >
      {children}
    </AppShell>
  )
}
