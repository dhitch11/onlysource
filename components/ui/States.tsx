/*
 * THE SHARED STATE SURFACES. Owner: T8 DESIGN.
 *
 * Designed once, centrally, and made easier for the other seven lanes to use than to write
 * their own. If a lane hand-rolls an empty state, that is a failure of this file, not of
 * that lane.
 *
 * -------------------------------------------------------------------------------------
 * THE EMPTY STATE IS WHERE THE PRODUCT IS TAUGHT, AND THERE ARE THREE OF THEM
 * -------------------------------------------------------------------------------------
 * They look similar and they are completely different facts. Collapsing them into one
 * "no data" screen is the single most common way an operator tool wastes someone's morning:
 *
 *   NEVER HAD DATA      teach the workflow, show what will appear here, offer ONE action
 *   FILTERED TO NOTHING name the filter that is excluding everything, offer to remove
 *                       exactly that one
 *   CANNOT KNOW         name the missing source, what it would add, and who can connect it
 *
 * An empty saved view that says whether it is empty because of a filter or because of
 * permissions is the difference between two support tickets that look identical.
 *
 * -------------------------------------------------------------------------------------
 * AND THE ONE THAT IS NOT AN ERROR AT ALL
 * -------------------------------------------------------------------------------------
 * INSUFFICIENT DATA is an ANSWER. The scoring engine has three dispositions, not two: flag,
 * skip, and abstain. An abstention gets a designed treatment that reads as competence, names
 * exactly what is missing, and is never a zero and never a dash.
 */

import styles from "./states.module.css";
import { Button } from "./Button";
import { useClockReady, useRelativeNow } from "./use-relative-now";

/* ------------------------------------------------------------------ 1. never had data */

export interface EmptyStateProps {
  /** What this surface will hold, in the operator's language. */
  title: string;
  /** What will appear here and when. If it depends on an ingest, say when that runs, with a
   *  real timestamp. Never a fake progress bar. */
  body: string;
  /** Exactly one action. Not two. If you cannot choose, the surface is not ready. */
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>{title}</p>
      <p className={styles.body}>{body}</p>
      {action ? (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- 2. filtered to nothing */

export interface NoResultsProps {
  /** The filter doing the excluding, named specifically enough to act on. */
  culpritFilter: string;
  /** Removes exactly that one filter. Not "clear all", which throws away the operator's
   *  other six decisions to fix the one that is wrong. */
  onClearCulprit: () => void;
  totalWithoutFilter?: number;
}

export function NoResults({ culpritFilter, onClearCulprit, totalWithoutFilter }: NoResultsProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>Nothing matches this view</p>
      <p className={styles.body}>
        <strong>{culpritFilter}</strong> is excluding everything.
        {totalWithoutFilter !== undefined ? (
          <>
            {" "}
            Without it this view holds <span className="mono">{totalWithoutFilter.toLocaleString()}</span>{" "}
            rows.
          </>
        ) : null}
      </p>
      <Button variant="secondary" onClick={onClearCulprit}>
        Remove {culpritFilter}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------- 3. cannot know */

export interface NotConnectedProps {
  /** The source, named as the operator would name it, not as the table is named. */
  source: string;
  /** One line on what connecting it would add TO THIS SURFACE specifically. */
  wouldAdd: string;
  /** Who can connect it. A role, so the reader knows whether to act or to ask. */
  whoCanConnect: string;
  /** The connections surface, which T7 owns. */
  connectHref?: string;
}

/**
 * Build the socket now, leave the plug empty, and make the empty plug a designed thing.
 *
 * NEVER hide the feature. NEVER show a fake value. NEVER let an absent credential produce a
 * cheerful zero. An operator who knows the data is missing can work around it. An operator
 * who finds out later cannot work with you.
 */
export function NotConnected({ source, wouldAdd, whoCanConnect, connectHref }: NotConnectedProps) {
  return (
    <div className={`${styles.panel} ${styles.socket}`}>
      <p className={styles.title}>{source} is not connected</p>
      <p className={styles.body}>{wouldAdd}</p>
      <p className={styles.meta}>Can be connected by: {whoCanConnect}</p>
      {connectHref ? (
        <a className={styles.link} href={connectHref}>
          Open connections
        </a>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ insufficient data */

export interface InsufficientDataProps {
  /** Exactly what is missing. Never a generic "not enough data". */
  missing: string;
}

/** An answer, not a failure. Never a zero, never a dash. */
export function InsufficientData({ missing }: InsufficientDataProps) {
  return (
    <span className={styles.insufficient}>
      <span className={styles.insufficientGlyph} aria-hidden="true" />
      <span>insufficient inputs</span>
      <span className={styles.insufficientWhy}>{missing}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- partial coverage */

export interface PartialCoverageProps {
  indexed: number;
  total: number;
  /** What is being counted, for example "NSNs in the scan". */
  of: string;
}

/** States what fraction of the picture is present rather than implying completeness. */
export function PartialCoverage({ indexed, total, of }: PartialCoverageProps) {
  const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
  return (
    <p className={styles.partial}>
      <span className="mono">
        {indexed.toLocaleString()} of {total.toLocaleString()}
      </span>{" "}
      {of} indexed ({pct}%). This surface is partial and does not yet cover the rest.
    </p>
  );
}

/* ------------------------------------------------------------------------------ stale */

export interface StaleBannerProps {
  asOf: string;
  onRefresh?: () => void;
}

/**
 * Keep the data VISIBLE and show its age plainly. Never replace old numbers with a spinner.
 * Operators would rather see yesterday's number labelled yesterday than nothing at all, and
 * a number rendered without its as-of is a claim with the expiry removed.
 */
export function StaleBanner({ asOf, onRefresh }: StaleBannerProps) {
  // A staleness banner that froze its own clock would be the one component in the product whose
  // lie is the exact thing it exists to report. Refreshed every minute. And no locale-dependent
  // text before mount: `toLocaleString` renders a different clock face on a UTC server than in
  // the reader's browser, which is a hydration mismatch only production can see.
  const nowMs = useRelativeNow(60_000);
  const ready = useClockReady();
  const when = new Date(asOf);
  const hrs = Math.floor((nowMs - when.getTime()) / 3600000);
  return (
    <div className={styles.stale} role="status">
      <span>
        Showing data from <strong>{ready ? when.toLocaleString() : asOf}</strong>
        {ready && Number.isFinite(hrs) ? `, ${hrs}h old` : ""}. It has not refreshed since.
      </span>
      {onRefresh ? (
        <Button variant="quiet" onClick={onRefresh}>
          Refresh
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------ error */

export interface ErrorStateProps {
  /** What failed, in the operator's language. Not a stack trace, not a cheerful lie. */
  what: string;
  /** What it means for the work in front of them. */
  meaning: string;
  /** What to do next. */
  next: string;
  /** An identifier support can trace. Without this the operator has nothing to quote. */
  traceId: string;
  onRetry?: () => void;
}

export function ErrorState({ what, meaning, next, traceId, onRetry }: ErrorStateProps) {
  return (
    <div className={`${styles.panel} ${styles.error}`} role="alert">
      <p className={styles.title}>{what}</p>
      <p className={styles.body}>{meaning}</p>
      <p className={styles.body}>{next}</p>
      <p className={styles.meta}>
        Reference <span className="mono">{traceId}</span>
      </p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ permission denied */

export interface PermissionDeniedProps {
  /** What the surface is. Say that it EXISTS. */
  surface: string;
  /** The role that would be able to see it, so the reader knows who to ask. */
  requiredRole: string;
}

/**
 * Say that it exists and that this role cannot see it. Do NOT pretend the surface is absent.
 * A hidden feature and a forbidden one look identical to the user and generate completely
 * different support conversations.
 */
export function PermissionDenied({ surface, requiredRole }: PermissionDeniedProps) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>{surface} exists, and your role cannot open it</p>
      <p className={styles.body}>
        This needs the <strong>{requiredRole}</strong> role. Your administrator can grant it.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- loading, cold */

export interface SkeletonProps {
  /** Number of rows to reserve. Match the real layout so nothing shifts when data lands. */
  rows?: number;
}

/**
 * Skeletons that match the SHAPE of what is coming, not spinners. A grid that reflows when
 * data lands makes people misclick, and misclicks in this product submit things to the
 * government.
 */
export function Skeleton({ rows = 6 }: SkeletonProps) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonRow} />
      ))}
      <span role="status" aria-live="polite" className="vh">
        Loading
      </span>
    </div>
  );
}
