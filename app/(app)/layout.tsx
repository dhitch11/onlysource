import { env } from '@/lib/env'
import { buildIdentity } from '@/lib/build-identity'
import { requireGateSession } from '@/lib/session/require-gate'
import { leaveAction } from '../(auth)/enter/actions'
import { AppShell, type NavGroup } from '@/components/shell/AppShell'
import { FeedFreshnessPill } from '@/components/shell/FeedFreshnessPill'
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
 * THE NAVIGATION IS THE WORKFLOW (owner directive 2026-08-16: "the menu itself teaches
 * the workflow", "condensed tools, elementary language, action behind everything").
 *
 * Four stages, in working order, read top to bottom:
 *
 *   FIND      the surfaces that hunt for money (the monopoly map, the no-quote list, the
 *             set-asides). Condensed to the three genuinely distinct opportunity classes.
 *   DECIDE    the evidence surfaces an operator checks before spending a dollar.
 *   PURSUE    the pipeline and the tools that move a find to a close. ONE pipeline entry:
 *             the old second "Hunter Mode" nav row (same href as Sales Hub) is gone, and
 *             Hunter Mode lives where it always ran, as the emphasised module inside
 *             /sales. Two rows to one page taught that there were two tools; there is one.
 *   ORG       admin and settings, at the bottom, out of the working path.
 *
 * EVERY item carries a one-line `description` in elementary language. It renders in the
 * NavGuide ("What each tool does", the nav-foot explainer) and as the row's title
 * supplement, so a brand-new user learns the system in one read.
 *
 * EVERY route that was in the old nav is still in this nav (13 rows to 12: only the
 * duplicate href was removed), so no URL lost its way in. The /design gallery stays
 * internal, reachable by URL, deliberately unlisted.
 *
 * COUNTS: a `count` is a claim about how much work is waiting, so it is computed from the
 * real files below or absent. Never a placeholder.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    items: [
      {
        href: '/',
        label: 'Dashboard',
        icon: 'dashboard',
        description: 'Your whole day on one screen: the strongest find, your pipeline, the award clock.',
      },
    ],
  },
  {
    id: 'find',
    label: 'Find',
    blurb: 'Where the opportunities surface.',
    items: [
      {
        href: '/monopoly',
        label: 'Monopoly Map',
        icon: 'map',
        description: 'Parts only one company can make, where that company has gone quiet.',
      },
      {
        href: '/goldmine',
        label: 'No-Quote Goldmine',
        icon: 'goldmine',
        description: 'Buys the government asked for and nobody answered. Zero competition.',
      },
      {
        href: '/hubzone',
        label: 'HUBZone set-asides',
        icon: 'hubzone',
        description: 'Buys reserved for HUBZone-certified small firms.',
      },
    ],
  },
  {
    id: 'decide',
    label: 'Decide',
    blurb: 'Check the evidence before you spend.',
    items: [
      {
        href: '/intelligence',
        label: 'Intelligence',
        icon: 'intelligence',
        description: 'The whole market added up: where the money is and how prices moved.',
      },
      {
        href: '/board',
        label: 'The Board',
        icon: 'board',
        description: 'Every open government requirement today, ranked by measured signal.',
      },
      {
        href: '/competitor',
        label: 'Competitor teardown',
        icon: 'competitor',
        description: 'Everything one company is approved to make, and where it stands alone.',
      },
    ],
  },
  {
    id: 'pursue',
    label: 'Pursue',
    blurb: 'Turn a find into a closed deal.',
    items: [
      {
        href: '/sales',
        label: 'Pipeline',
        icon: 'sales',
        tag: 'CRM',
        description: 'Your deals, moved stage by stage to won. Hunter Mode, the autonomous outreach engine, lives here; it is not running until you switch it on.',
      },
      {
        href: '/suppliers',
        label: 'Suppliers',
        icon: 'suppliers',
        description: 'Companies holding dead stock you could buy out, with real contacts.',
      },
      {
        href: '/documents',
        label: 'Documents & POs',
        icon: 'documents',
        description: 'Quotes, purchase orders and the paper trail that closes a deal.',
      },
    ],
  },
  {
    id: 'org',
    label: 'Org',
    blurb: 'The organization itself.',
    items: [
      {
        href: '/admin',
        label: 'Admin & Users',
        icon: 'admin',
        description: 'Who can sign in and what each person may do.',
      },
      {
        href: '/settings',
        label: 'Settings',
        icon: 'settings',
        description: 'Your account, alerts and preferences.',
      },
    ],
  },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireGateSession('/')

  const e = env()
  const environment = e.APP_ENV ?? e.NODE_ENV
  // Resolved from the running tree, not the deploy-time stamp: the stamp went 52 commits
  // stale on the live droplet while this badge kept naming it (audit 2026-08-17). See
  // lib/build-identity.ts for the resolution order.
  const commit = buildIdentity().commit?.slice(0, 7) ?? 'local'

  // A REAL nav count for the Monopoly Map, or none. Computed only when the data directory is
  // present, because a badge is a claim about how much work is waiting and a fabricated one is
  // the same trust cost as a fabricated number. buildAllDatasets is memoized, so this shares
  // the build with the Monopoly page on the same request rather than reading the files twice.
  const dataPresent = resolveDataRoot().present
  // The feed day every surface is reading, shown once in the chrome so the operator always knows how
  // fresh the data is. A real measured value from the corner map's provenance, or nothing.
  const feedDay = dataPresent ? buildAllDatasets().cornerMap.provenance.feedDay : null
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((d) => {
      if (!dataPresent) return d
      if (d.href === '/monopoly') return { ...d, count: buildAllDatasets().cornerMap.summary.candidateCorners }
      if (d.href === '/suppliers') {
        const sup = buildDistressedSuppliers()
        return sup.ok ? { ...d, count: sup.counts.tierA } : d
      }
      return d
    }),
  }))

  return (
    <AppShell
      user={{ name: 'David Hitchman', role: 'Owner', title: 'ProjectX' }}
      org={{ name: 'ONLYSOURCE' }}
      groups={groups}
      meta={
        <>
          {/*
           * The freshness pill. Its tone is MEASURED from the served feed day's age in
           * business days, never a hardcoded ok-state, and its eye button explains the
           * feed day, the capture instant and what stale means. The old inline pill here
           * carried `pill--ok` as a literal and a banned title tooltip; both are gone.
           */}
          <FeedFreshnessPill servedFeedDay={feedDay} />
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
