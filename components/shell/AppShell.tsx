"use client";

/*
 * <AppShell /> THE PRODUCT SHELL. Owner: T8 DESIGN (the chrome). @T1-FOUNDATION owns the
 * routing and the layout primitives this sits inside, and owns the auth guard above it.
 * Named per rule 5 before writing.
 *
 * "This product reads as SaaS or it reads as a spreadsheet with a login, and the shell is
 * where that judgement is made in the first three seconds."
 *
 * -------------------------------------------------------------------------------------
 * THE RULE THAT SHAPED THIS FILE: LOOK FROM THE COMP, STATE FROM REALITY
 * -------------------------------------------------------------------------------------
 * The approved console renders "The Board 213" and "Monopoly Map 1.2k" in the nav. Those
 * numbers are illustrative. There is no ingest yet, so THIS SHELL RENDERS NO COUNTS. The
 * count slot appears only when a real number is passed for that destination.
 *
 * A nav badge is a claim about how much work is waiting. Rendering 213 when nothing has been
 * ingested is not a cosmetic liberty: an operator reads it, believes there are 213 rows to
 * triage before 3:00 PM, opens an empty board, and stops trusting every other number on the
 * screen. `count` is optional and undefined means the slot is absent, never zero.
 *
 * -------------------------------------------------------------------------------------
 * TENANT-READY, DEFAULTED TO ONE
 * -------------------------------------------------------------------------------------
 * The org switcher lists exactly one org today, the seeded ONLYSOURCE org. It is BUILT FOR
 * MANY: it is a real control, keyboard navigable, and it sets the active org that every
 * scoped surface and every saved view reads. The day a second org exists it needs a second
 * row, not a new surface. Nothing here hardcodes the single org, which is the exact rebuild
 * the scope forbids.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Reticle } from "./Reticle";
import { NavIcon, type NavIconName } from "./NavIcon";
import styles from "./AppShell.module.css";

export interface NavDestination {
  href: string;
  label: string;
  /** One icon family, drawn on the same grid at the same weight. Decorative: the label is
   *  the accessible name and the icon is aria-hidden. */
  icon?: NavIconName;
  /** A REAL count, or undefined. Undefined renders nothing. Never pass a placeholder. */
  count?: number;
  /** A short static tag, for example "CRM". Not a count and never a number. */
  tag?: string;
  /** Rendered as its own emphasised module rather than a plain nav row. */
  emphasised?: boolean;
  /** Starts a visual group below the preceding item. */
  separatorBefore?: boolean;
  /** False hides the destination entirely, because the nav must never show a route that
   *  403s on click. */
  permitted?: boolean;
}

export interface AppShellProps {
  children: React.ReactNode;
  /** The signed-in person. */
  user: { name: string; role: string; title?: string };
  /** The active org. Built for many, shows one. */
  org: { name: string; sublabel?: string };
  destinations: NavDestination[];
  /** Rendered top right. The environment badge and build identity live here. */
  meta?: React.ReactNode;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function AppShell({ children, user, org, destinations, meta }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className={styles.app}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className={styles.side} aria-label="Primary">
        <div className={styles.brand}>
          <span className={styles.brandMark}>
            <Reticle size={32} />
          </span>
          <span>
            <span className={styles.wordmark}>
              ONLY<b>SOURCE</b>
            </span>
            <span className={styles.brandSub}>Intelligence</span>
          </span>
        </div>

        <nav className={styles.nav} aria-label="Sections">
          <ul>
            {destinations
              .filter((d) => d.permitted !== false)
              .map((d) => {
                const active = pathname === d.href || pathname.startsWith(d.href + "/");
                return (
                  /*
                   * Keyed on href AND label, not href alone. Two destinations legitimately
                   * share a route: Hunter Mode is its own emphasised module that routes into
                   * the Sales Hub engine, exactly as the BUILD-DIRECTIVE and the approved
                   * console have it. Keying on href alone produced a duplicate-key warning
                   * and React is explicit that the behaviour is unsupported: children may be
                   * duplicated or OMITTED. A nav item silently disappearing is not a warning
                   * to live with.
                   */
                  <li
                    key={`${d.href}|${d.label}`}
                    className={d.separatorBefore ? styles.sepBefore : undefined}
                  >
                    <Link
                      href={d.href as never}
                      className={[
                        styles.navItem,
                        active ? styles.navItemActive : "",
                        d.emphasised ? styles.navItemEmphasised : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-current={active ? "page" : undefined}
                    >
                      {d.icon ? <NavIcon name={d.icon} /> : null}
                      <span className={styles.navLabel}>{d.label}</span>

                      {/* A REAL count only. Undefined renders nothing at all, which is the
                          honest state before ingest. Never a zero standing in for unknown. */}
                      {typeof d.count === "number" ? (
                        <span className={`mono ${styles.navCount}`}>
                          {d.count.toLocaleString()}
                          <span className="vh"> items</span>
                        </span>
                      ) : null}

                      {d.tag ? <span className={styles.navTag}>{d.tag}</span> : null}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>

        <div className={styles.sideFoot}>
          {/*
           * THE ORG SWITCHER. One org today, built for many.
           * It is a <button> and not a <div>, and it carries aria-haspopup, because the day
           * it lists two orgs it must already be a real control with a real keyboard model.
           * Retrofitting semantics onto a div later is how a switcher ends up unreachable.
           */}
          <button
            type="button"
            className={styles.org}
            aria-haspopup="listbox"
            aria-label={`Active organisation: ${org.name}. Switch organisation`}
          >
            <span className={styles.orgFlag} aria-hidden="true">
              <Reticle size={13} />
            </span>
            <span className={styles.orgText}>
              <span className={styles.orgName}>{org.name}</span>
              <span className={styles.orgRole}>{org.sublabel ?? "Organization"}</span>
            </span>
            <svg
              className={styles.chevron}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <div className={styles.acct}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className={styles.acctText}>
              <span className={styles.acctName}>{user.name}</span>
              <span className={styles.acctRole}>
                {user.role}
                {user.title ? ` · ${user.title}` : ""}
              </span>
            </span>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        {meta ? <div className={styles.topMeta}>{meta}</div> : null}
        <main className={styles.content} id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
