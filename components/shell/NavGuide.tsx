"use client";

/*
 * <NavGuide /> "What each tool does." Owner: T8 DESIGN.
 *
 * The one-read explainer for the whole menu, reachable from the nav foot. A brand-new user
 * presses it and learns the system in one screen: the four working stages in order, and one
 * plain sentence per tool. It renders ONLY the same groups and descriptions the nav itself
 * is built from, passed in as props, so the guide and the menu can never disagree.
 *
 * Interaction contract copied from <ExplainButton>, the settled house pattern: a real
 * focusable <button> toggling a native `popover="auto"` panel. Top layer (nothing clips
 * it), light dismiss, Escape-to-close with focus return, all native. HOVER OPENS NOTHING
 * (Quality Bar R4). Not a `title` tooltip: this is the accessible channel the row-level
 * title attributes merely supplement.
 */

import { useId, useState } from "react";
import { NavIcon } from "./NavIcon";
import type { NavGroup } from "./AppShell";
import styles from "./NavGuide.module.css";

/** The working order, spelled out once. Close is not a nav group: it happens in the
 *  pipeline and the paperwork, and the sentence below says exactly that. */
const FLOW = "Find → Decide → Pursue → Close";

export function NavGuide({ groups }: { groups: NavGroup[] }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-details={panelId}
        popoverTarget={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {/* The eye-in-circle: the owner's chosen mark for "here is a plain explanation." */}
        <svg className={styles.eye} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.3" />
          <path
            d="M5 10c1.4-2.1 3.1-3.2 5-3.2s3.6 1.1 5 3.2c-1.4 2.1-3.1 3.2-5 3.2s-3.6-1.1-5-3.2Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="1.7" fill="currentColor" />
        </svg>
        What each tool does
      </button>

      <div id={panelId} popover="auto" className={styles.panel}>
        <p className={styles.flow}>
          <span className="mono">{FLOW}</span>
        </p>
        <p className={styles.lead}>
          The menu is the method, top to bottom: find the money, check the evidence, then
          work it to a close in the pipeline. Closing happens in Pipeline and Documents,
          where a quote goes out and a purchase order comes back.
        </p>

        {groups.map((g) => (
          <section key={g.id} className={styles.section}>
            {g.label ? (
              <h3 className={styles.sectionHead}>
                {g.label}
                {g.blurb ? <span className={styles.blurb}> {g.blurb}</span> : null}
              </h3>
            ) : null}
            <ul className={styles.list}>
              {g.items
                .filter((d) => d.permitted !== false)
                .map((d) => (
                  <li key={`${d.href}|${d.label}`} className={styles.row}>
                    <span className={styles.rowIcon} aria-hidden="true">
                      {d.icon ? <NavIcon name={d.icon} /> : null}
                    </span>
                    <span className={styles.rowText}>
                      <span className={styles.rowLabel}>{d.label}</span>
                      <span className={styles.rowDesc}>{d.description}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
