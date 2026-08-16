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
 * THE NAV IS THE WORKFLOW (owner directive 2026-08-16)
 * -------------------------------------------------------------------------------------
 * The menu itself teaches the system: tools are grouped under tiny stage labels in working
 * order (FIND the money, DECIDE on the evidence, PURSUE it to the close, then the org rows
 * at the bottom). A brand-new user reads the left rail top to bottom and has the whole
 * method. Every item carries a one-line elementary description, surfaced two ways:
 *
 *   1. The "What each tool does" guide at the nav foot: a real focusable button opening a
 *      native popover that lists every group and tool in plain language. This is the
 *      accessible channel, reachable by keyboard and touch.
 *   2. A `title` attribute on each row. The house rule against `title` (R3/R4) bans it as
 *      the ONLY channel for information; here it is a pointer-hover supplement to the guide,
 *      added on the owner's explicit direction, and the guide carries the same words for
 *      everyone the attribute cannot reach.
 *
 * -------------------------------------------------------------------------------------
 * THE RULE THAT SHAPED THIS FILE: LOOK FROM THE COMP, STATE FROM REALITY
 * -------------------------------------------------------------------------------------
 * The count slot appears only when a real number is passed for that destination. A nav
 * badge is a claim about how much work is waiting: rendering 213 when nothing has been
 * ingested teaches the operator to distrust every other number on the screen. `count` is
 * optional and undefined means the slot is absent, never zero.
 *
 * -------------------------------------------------------------------------------------
 * TENANT-READY, DEFAULTED TO ONE
 * -------------------------------------------------------------------------------------
 * The org switcher lists exactly one org today, the seeded ONLYSOURCE org. It is BUILT FOR
 * MANY: it is a real control, keyboard navigable, and it sets the active org that every
 * scoped surface and every saved view reads. The day a second org exists it needs a second
 * row, not a new surface.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Reticle } from "./Reticle";
import { NavIcon, type NavIconName } from "./NavIcon";
import { NavGuide } from "./NavGuide";
import styles from "./AppShell.module.css";

export interface NavDestination {
  href: string;
  label: string;
  /**
   * One line, elementary language, for a person who has never seen the product:
   * "Parts only one company can make" beats "Monopoly Map candidates". Rendered in the
   * guide and as the row's title supplement. Required: a tool that cannot be explained in
   * one plain sentence is not ready for the nav.
   */
  description: string;
  /** One icon family, drawn on the same grid at the same weight. Decorative: the label is
   *  the accessible name and the icon is aria-hidden. */
  icon?: NavIconName;
  /** A REAL count, or undefined. Undefined renders nothing. Never pass a placeholder. */
  count?: number;
  /** A short static tag, for example "CRM". Not a count and never a number. */
  tag?: string;
  /** False hides the destination entirely, because the nav must never show a route that
   *  403s on click. */
  permitted?: boolean;
}

export interface NavGroup {
  /** Stable key for React and the guide. */
  id: string;
  /** The stage eyebrow, e.g. "Find". Absent renders the items with no header (the top
   *  group: the dashboard). */
  label?: string;
  /** One elementary sentence about the stage, shown in the guide. */
  blurb?: string;
  items: NavDestination[];
}

export interface AppShellProps {
  children: React.ReactNode;
  /** The signed-in person. */
  user: { name: string; role: string; title?: string };
  /** The active org. Built for many, shows one. */
  org: { name: string; sublabel?: string };
  /** The workflow, in working order. The separator between work and org rows is the
   *  group boundary itself. */
  groups: NavGroup[];
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

export function AppShell({ children, user, org, groups, meta }: AppShellProps) {
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
          {groups.map((g) => {
            const labelId = g.label ? `navgroup-${g.id}` : undefined;
            return (
              <div key={g.id} className={styles.group}>
                {g.label ? (
                  /*
                   * The stage eyebrow. 11px uppercase tracked, matching the severity-chip
                   * eyebrow precedent (.signalCard__sev). The 13px --fs-100 floor governs
                   * copy a person reads for content; this is a two-syllable landmark whose
                   * full text also lives at readable size inside the guide.
                   */
                  <p className={styles.groupLabel} id={labelId} aria-hidden="true">
                    {g.label}
                  </p>
                ) : null}
                <ul aria-labelledby={labelId}>
                  {g.items
                    .filter((d) => d.permitted !== false)
                    .map((d) => {
                      const active =
                        pathname === d.href || pathname.startsWith(d.href + "/");
                      return (
                        <li key={`${d.href}|${d.label}`}>
                          <Link
                            href={d.href as never}
                            className={[styles.navItem, active ? styles.navItemActive : ""]
                              .filter(Boolean)
                              .join(" ")}
                            aria-current={active ? "page" : undefined}
                            /* Supplement only; the guide is the accessible channel. */
                            title={d.description}
                          >
                            {d.icon ? <NavIcon name={d.icon} /> : null}
                            <span className={styles.navLabel}>{d.label}</span>

                            {/* A REAL count only. Undefined renders nothing at all, which
                                is the honest state before ingest. Never a zero standing in
                                for unknown. */}
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
              </div>
            );
          })}

          {/* The one-read explainer for the whole menu. A real button, keyboard and touch
              reachable, opening the plain-language guide. */}
          <NavGuide groups={groups} />
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
            aria-label={`Active organization: ${org.name}. Switch organization`}
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
