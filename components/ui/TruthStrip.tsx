/*
 * <TruthStrip /> Owner: T8 DESIGN. Numbers supplied by the lane that owns each source.
 *
 * The permanent, NON-COLLAPSIBLE data-provenance band on every data screen. It states what
 * the screen is built from and how old that is.
 *
 * IT SHIPS BEFORE THE GRID. That ordering is a war room ruling from the Principal User
 * chair, not a preference: an explain button on a stale column is a more convincing lie
 * than no explain button at all. Truth, then explanation, then grid.
 *
 * It is not collapsible and it has no dismiss control. If you are looking for a prop to
 * hide it, there deliberately is not one.
 *
 * HOUSE LAW 1 APPLIES TO THIS COMPONENT MOST OF ALL: pass it real counts from the ingest
 * records, or pass it nothing and let it say the source has not arrived. Never pass a
 * plausible number to make the band look populated.
 */

import styles from "./TruthStrip.module.css";
import { ExplainButton } from "./ExplainButton";
import { useClockReady, useRelativeNow } from "./use-relative-now";

export interface TruthSource {
  /** What the source is called in the operator's language, not the table name. */
  label: string;
  /** Real count received. Undefined means the source has not arrived, which renders as an
   *  honest absence rather than a zero. A zero and an absence are different facts. */
  count?: number;
  /** ISO timestamp of receipt. Undefined renders as "not received". */
  receivedAt?: string;
  /** Records that failed to parse and are held for inspection. */
  quarantined?: number;
  /** Where the quarantined records can be read. Required when quarantined > 0, because a
   *  count nobody can open is not accountability. */
  quarantineHref?: string;
  /** Set when the whole source is unavailable, with the reason in operator language. */
  unavailableReason?: string;
}

export interface TruthStripProps {
  sources: TruthSource[];
  /** The org this screen is scoped to. Permanent, per section 4.19: with one org it reads
   *  as quiet confirmation, with two it becomes load-bearing. Build it now. */
  orgName: string;
  /** Stated fraction indexed, for surfaces that are live but thin. Never imply
   *  completeness. */
  partialCoverage?: { indexed: number; total: number; of: string };
}

/*
 * NO LOCALE-DEPENDENT TEXT MAY CROSS THE HYDRATION BOUNDARY. Learned twice on this component.
 *
 * First lesson: reading the clock during render made server and client disagree on the age.
 * Second lesson, found only by diffing prod SSR HTML against the hydrated DOM: `toLocaleTimeString`
 * is TIMEZONE and LOCALE dependent, so the droplet (UTC) rendered "10:30 AM" where the browser
 * (local time) rendered a different clock face for the same instant. Same instant, different text,
 * hydration error #418 — but only on a server whose timezone differs from the reader's, which is
 * why it reproduced on production and never on the machine it was built on.
 *
 * So before mount, `stamp` renders the DETERMINISTIC form (the ISO date, identical everywhere),
 * and the friendly local clock face appears one frame later, where there is no server tree left
 * to disagree with.
 */
function stamp(iso: string | undefined, nowMs: number, ready: boolean): string {
  if (!iso) return "not received";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "unknown";
  if (!ready) return iso.slice(0, 10);
  const mins = Math.floor((nowMs - t.getTime()) / 60000);
  const clock = t.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (mins < 60) return `${clock} (${mins} min ago)`;
  if (mins < 1440) return `${clock} (${Math.floor(mins / 60)}h ago)`;
  return t.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TruthStrip({ sources, orgName, partialCoverage }: TruthStripProps) {
  // Refreshed every minute: this strip is exactly the thing an operator leaves on screen and
  // glances back at, so its age has to keep moving.
  const nowMs = useRelativeNow(60_000);
  const ready = useClockReady();
  const anyStale = sources.some((s) => {
    if (!s.receivedAt) return true;
    return nowMs - new Date(s.receivedAt).getTime() > 24 * 3600 * 1000;
  });

  return (
    <aside
      className={`${styles.strip} ${anyStale ? styles.stale : ""}`}
      aria-label="Data provenance for this screen"
    >
      <span className={styles.glyph} aria-hidden="true" />

      <span className={styles.scope}>
        <span className={styles.scopeLabel}>Scope</span>
        <strong>{orgName}</strong>
      </span>

      <span className={styles.divider} aria-hidden="true" />

      <ul className={styles.sources}>
        {sources.length === 0 ? (
          <li className={styles.absent}>No data sources are connected to this screen yet.</li>
        ) : (
          sources.map((s) => (
            <li key={s.label}>
              {s.unavailableReason ? (
                <>
                  <strong>{s.label}</strong>
                  <span className={styles.absent}> {s.unavailableReason}</span>
                </>
              ) : (
                <>
                  <strong>{s.label}</strong>{" "}
                  {s.count === undefined ? (
                    <span className={styles.absent}>not received</span>
                  ) : (
                    <span className="mono">{s.count.toLocaleString()}</span>
                  )}{" "}
                  <span className={styles.when}>{stamp(s.receivedAt, nowMs, ready)}</span>
                  {s.quarantined && s.quarantined > 0 ? (
                    <>
                      {" "}
                      <span className={styles.quarantine}>
                        <span className="mono">{s.quarantined}</span> quarantined
                      </span>{" "}
                      {s.quarantineHref ? (
                        <a href={s.quarantineHref} className={styles.view}>
                          view
                        </a>
                      ) : null}
                    </>
                  ) : null}
                </>
              )}
            </li>
          ))
        )}
      </ul>

      {partialCoverage ? (
        <span className={styles.partial}>
          <span className="mono">
            {partialCoverage.indexed.toLocaleString()} of {partialCoverage.total.toLocaleString()}
          </span>{" "}
          {partialCoverage.of} indexed
        </span>
      ) : null}

      <span className={styles.explain}>
        <ExplainButton helpId="ui.truth_strip" size="sm" />
      </span>
    </aside>
  );
}
