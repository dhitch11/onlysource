import { env } from '@/lib/env'
import { requireGateSession } from '@/lib/session/require-gate'
import { leaveAction } from '../(auth)/enter/actions'
import { AppShell, type NavDestination } from '@/components/shell/AppShell'
import { NotificationCenter } from '@/components/shell/NotificationCenter'
import { buildAllDatasets } from '@/lib/intelligence/datasets'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { resolveDataRoot } from '@/lib/data-root'

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
/**
 * NAV ORDER: most important to least, with settings and internal tools at the bottom
 * (David 2026-08-15). The dashboard is the flagship and leads. Then the money surfaces in the
 * order an operator works them: the analytics breakdown, the highest-intent no-quote list, the
 * monopoly map, the supplier book. Then the working tools. Then, below a separator, the admin,
 * settings, and internal design reference.
 */
const DESTINATIONS: NavDestination[] = [
  // ---- the flagship + the money surfaces ----
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/intelligence', label: 'Intelligence', icon: 'intelligence' },
  // The No-Quote Goldmine — government buys that drew zero quotes. Highest-intent revenue.
  { href: '/goldmine', label: 'No-Quote Goldmine', icon: 'goldmine' },
  // HUBZone set-aside solicitations (a distinct, eligibility-gated opportunity class).
  { href: '/hubzone', label: 'HUBZone set-asides', icon: 'hubzone' },
  { href: '/monopoly', label: 'Monopoly Map', icon: 'map' },
  // The enriched distressed-supplier book of business (count = Tier-A tally, computed below).
  { href: '/suppliers', label: 'Suppliers', icon: 'suppliers' },
  // Competitor teardown — every part a company is approved to make, split into their monopolies vs
  // where they compete. Loads from any <company>-parts.xlsx export.
  { href: '/competitor', label: 'Competitor teardown', icon: 'competitor' },
  // ---- the working tools ----
  { href: '/board', label: 'The Board', icon: 'board', separatorBefore: true },
  { href: '/sales', label: 'Sales Hub', icon: 'sales', tag: 'CRM' },
  // Hunter Mode routes into the Sales Hub engine; no live tag until the engine reports (honest).
  { href: '/sales', label: 'Hunter Mode', icon: 'hunter', emphasised: true },
  { href: '/documents', label: 'Documents & POs', icon: 'documents' },
  // ---- admin, settings, internal (the bottom) ----
  { href: '/admin', label: 'Admin & Users', icon: 'admin', separatorBefore: true },
  { href: '/settings', label: 'Settings', icon: 'settings' },
  // The Design system reference is internal (component gallery for builders), not an operator tool,
  // so it is NOT in the nav. It stays reachable at /design by URL for whoever is building.
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireGateSession('/')

  const e = env()
  const environment = e.APP_ENV ?? e.NODE_ENV
  const commit = e.GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'

  // A REAL nav count for the Monopoly Map, or none. Computed only when the data directory is
  // present, because a badge is a claim about how much work is waiting and a fabricated one is
  // the same trust cost as a fabricated number. buildAllDatasets is memoized, so this shares
  // the build with the Monopoly page on the same request rather than reading the files twice.
  const dataPresent = resolveDataRoot().present
  // The feed day every surface is reading, shown once in the chrome so the operator always knows how
  // fresh the data is. A real measured value from the corner map's provenance, or nothing.
  const feedDay = dataPresent ? buildAllDatasets().cornerMap.provenance.feedDay : null
  const destinations = DESTINATIONS.map((d) => {
    if (!dataPresent) return d
    if (d.href === '/monopoly') return { ...d, count: buildAllDatasets().cornerMap.summary.candidateCorners }
    if (d.href === '/suppliers') {
      const sup = buildDistressedSuppliers()
      return sup.ok ? { ...d, count: sup.counts.tierA } : d
    }
    return d
  })

  return (
    <AppShell
      user={{ name: 'David Hitchman', role: 'Owner', title: 'ProjectX' }}
      org={{ name: 'ONLYSOURCE' }}
      destinations={destinations}
      meta={
        <>
          {feedDay ? (
            <span className="pill pill--ok" title={`Government data for ${feedDay}`}>
              <span className="vh">Government data as of </span>
              Gov data · {feedDay}
            </span>
          ) : null}
          {/* A quiet fact, not an alert: amber stays reserved for the award clock. */}
          <span className="pill pill--off">{environment}</span>
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
          <NotificationCenter />
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
