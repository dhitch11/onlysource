/**
 * THE BOARD, BUILT FROM THE GOVERNMENT'S OWN PUBLISHED FILES.
 *
 * This reads the two real files DLA publishes for a feed day and joins them. It computes
 * only what those two files can support, and it says so about everything else.
 *
 * What the two files CAN answer:
 *   - what is being bought, in what quantity, by when          (the daily index)
 *   - who is approved to make it                                (the approved-source file)
 *   - whether the buy is automated-award eligible               (solicitation ninth character)
 *   - how many approved sources exist, so whether it is sole-sourced
 *
 * What they CANNOT answer, and which therefore ABSTAINS rather than guessing:
 *   - price of any kind. There is no award history in these files.
 *   - availability. Nothing here says whether a unit is on a shelf anywhere.
 *   - therefore modeled lift, and therefore a ranking score.
 *
 * The absence of an approved-source row is reported as UNKNOWN, never as "no approved
 * source". A locally assigned stock number carries no NIIN and so cannot join, and a
 * false absence in this product is the raw material of a sole-source corner somebody
 * would quote against.
 */
import { parseSolicitation } from "@/lib/intelligence/niin";
import { resolveServedFeedDay, type SkippedFeedDay } from "@/lib/intelligence/feed-day";
import {
  lifecycleAsOf,
  parseIndexReturnDate,
  type RowLifecycle,
} from "@/lib/intelligence/feed-window";
import { measureFeedFreshness } from "@/lib/ingest/feed-days";
import { systemClock, type Clock } from "@/lib/time/clock";

/*
 * WHICH DAY THE BOARD SHOWS: THE ONE EVERY OTHER SURFACE SHOWS. NOT A CONSTANT HERE.
 *
 * Until 2026-08-17 this module pinned `FEED_DAY = "2026-08-11"` and two literal paths, one of
 * them the DERIVED extraction `derived/.../as260811.txt`. Two things were wrong with that and
 * both were live:
 *
 *  1. THE CHROME AND THE TABLE COULD NAME DIFFERENT DAYS. The shell's freshness pill reads the
 *     served feed day out of the corner map's provenance. The moment that map started
 *     discovering the newest archived day, this page would still have printed "Feed day
 *     2026-08-11" over counts built from 2026-08-11 while the pill overhead said otherwise. A
 *     pill that names one day beside a table built from another is worse than staying pinned
 *     forever, because the operator has no way to tell which one to believe.
 *  2. THE 500-ROW FLOOR WOULD HAVE REFUSED EVERY REAL FRIDAY. `MIN_PLAUSIBLE_ROWS = 500` was
 *     calibrated on one mid-week day and described a working day as running "into the
 *     thousands". Measured across the whole 20-day archive that is only true Monday to
 *     Thursday (1,071 to 5,488 rows). All four archived Fridays publish 231, 313, 228 and 331
 *     rows. Under the old floor this page would have refused Friday's real government file as
 *     "truncated or substituted" every single week.
 *
 * So the day is resolved by lib/intelligence/feed-day.ts, the single resolution the corner
 * map, the monopoly view, the provenance lines and the pill all read, and the row floor is
 * that module's own MIN_SERVABLE_INDEX_ROWS (200, aligned with the ingest content gate) so
 * the instruments cannot disagree about what a real day is. The approved-source list is the
 * member read straight out of the archived zip, so no derived file sits in this chain either.
 */

export type SourceStanding =
  /** Exactly one company is approved. Buying the shelf makes us the only source. */
  | { kind: "sole"; cages: string[] }
  /** More than one approved company. Real competition for the buy. */
  | { kind: "multiple"; count: number }
  /** The join could not be made. NOT the same as "nobody is approved". */
  | { kind: "unjoined"; why: string };

export interface BoardRow {
  solicitation: string;
  nsn: string;
  niin: string | null;
  nomenclature: string;
  quantity: number | null;
  unitOfIssue: string;
  returnDate: string;
  purchaseRequest: string;
  /** T or U in the ninth position: the buy can be awarded by machine, on price alone. */
  automated: boolean | null;
  standing: SourceStanding;
  /**
   * Whether this requirement's own published return date has passed, judged against TODAY.
   * `last_seen_only` means the line carried no readable return date, which is a third state
   * and never a quiet "open".
   */
  lifecycle: RowLifecycle;
}

export interface BoardData {
  ok: true;
  feedDay: string;
  /**
   * Newer COMPLETE days the archive holds that would not parse-verify, by name and reason.
   * Empty means this IS the newest day the archive holds. Rendered, never hidden: the
   * difference between "nothing newer exists" and "something newer exists and we refused it"
   * is the whole difference between current data and silently stale data.
   */
  heldButNotServable: SkippedFeedDay[];
  /** How many feed days the archive verifiably holds, for the operator's sense of depth. */
  daysHeld: number;
  rows: BoardRow[];
  /** Every number here is a count of real published lines, never an estimate. */
  counts: {
    published: number;
    automated: number;
    soleSourced: number;
    /** Sole-sourced AND machine-awarded: the shape a corner takes. */
    corners: number;
    unjoined: number;
    /** Return date still ahead of `asOf`. The only rows an operator can actually still bid. */
    open: number;
    /** Return date already passed on `asOf`. Kept and labelled, never dropped. */
    closed: number;
    /** No readable return date in the published line. Not open, not closed: unanswerable. */
    undated: number;
  };
  /**
   * THE DAY THE BOARD WAS JUDGED AGAINST, and what that day is, in the operator's words.
   * It is TODAY on the publisher's calendar, not the feed day, and the two are different
   * claims. Rendered, never implied.
   */
  asOf: string;
  asOfBasis: string;
  /** Reported, never hidden: lines the parsers could not read. */
  drift: { offWidthRows: number; unparsedNsn: number; unparsedSourceLines: number };
}

export interface BoardUnavailable {
  ok: false;
  /** Named in the operator's terms, with the path, so this is actionable rather than mysterious. */
  reason: string;
  missing: string[];
}

/**
 * KEYED ON THE SERVED DAY, not a bare boolean. The old `let cache` had no key at all, which
 * was harmless while the day was a literal and would have been a defect the moment it stopped
 * being one: the first request of the process would have pinned the board to whatever day was
 * newest then, and a capture landing later in the same process could never have displaced it.
 */
const cache = new Map<string, BoardData>();

/**
 * `clock` is a parameter so a suite can pin the day this is judged against, exactly as
 * `buildDatasets` does. It defaults to the system clock; no module here reads a clock directly.
 */
export function buildBoard(clock: Clock = systemClock): BoardData | BoardUnavailable {
  const resolution = resolveServedFeedDay();

  if (!resolution.ok) {
    /*
     * NOT CACHED, deliberately: an absent or unusable archive can become a usable one while
     * the process is running (a capture lands, a volume mounts), and a cached absence would
     * outlive the condition that caused it. Every candidate tried is named, so this reads as
     * an actionable statement rather than an empty page.
     */
    return {
      ok: false,
      reason:
        `The Board renders what DLA published, and no archived feed day can be served right now: ${resolution.reason}. ` +
        "Nothing has been assumed in its place.",
      missing:
        resolution.skipped.length > 0
          ? resolution.skipped.map((s) => `${s.feedDay}: ${s.reason}`)
          : ["no verified capture of any feed day is readable under the resolved data root"],
    };
  }

  const served = resolution.served;

  /*
   * THE BOARD IS JUDGED AGAINST TODAY, NOT AGAINST THE FEED DAY IT IS BUILT FROM.
   *
   * DLA publishes a return date per requirement and that date passes whether or not our capture
   * ran. A board that judges "open" against its own feed day therefore keeps presenting expired
   * solicitations for exactly as long as the capture has been missed, and says "open" the whole
   * time. Measured on the windowed surface on 2026-08-18 against an archive whose newest day was
   * 2026-08-14: 5,122 of 10,488 rows, 48.8%, had already closed while the header read open.
   *
   * This is a single-day board, so on the morning a capture lands almost every row is genuinely
   * open and the count is near zero. That is exactly why it has to be computed rather than
   * assumed: the error is invisible when it is small and it grows silently with staleness.
   *
   * `measureFeedFreshness(...).measuredOn` is this estate's ONE definition of "the Eastern civil
   * date now", and it is the same call the freshness pill in the chrome makes. Reusing it means
   * the pill and this table can never name two different todays. A second clock here would be a
   * second answer.
   */
  const freshness = measureFeedFreshness(served.feedDay, clock.now());
  const asOf = freshness.measuredOn;
  const behind = `${freshness.businessDaysBehind} US federal business day${freshness.businessDaysBehind === 1 ? "" : "s"}`;
  const asOfBasis =
    asOf === served.feedDay
      ? "the day this was computed, which is also the feed day shown"
      : asOf > served.feedDay
        ? `the day this was computed, ${behind} after the feed day ${served.feedDay}`
        : `the day this was computed, which is earlier than the feed day ${served.feedDay}`;

  // The reference day is part of the key: a board judged yesterday must not be served today.
  const key = `${served.feedDay}|${served.indexStorageKey}|${served.archive.storageKey}|${asOf}`;
  const hit = cache.get(key);
  if (hit) return hit;

  /*
   * The index and the approved-source list are ALREADY PARSED, once, by the resolution, and
   * every surface shares that one read of those bytes. That is the point: the board and the
   * corner map can no longer disagree about what the day's file said, because there is only
   * one parse of it. The row floor and the fixed-width check ran there too — a day that
   * resolves has passed both — so re-testing them here would be a guard that can never fire.
   */
  const index = served.index;
  const sources = served.approved;

  const rows: BoardRow[] = index.rows.map((r) => {
    const form = parseSolicitation(r.solicitation);
    let standing: SourceStanding;

    if (r.niin == null) {
      standing = {
        kind: "unjoined",
        why: "locally assigned stock number: no NIIN to join on. Approved sources may well exist.",
      };
    } else {
      const cages = sources.byNiin.get(r.niin);
      if (!cages || cages.size === 0) {
        standing = {
          kind: "unjoined",
          why: "no approved-source row published this feed day. A gap in the file, not proof nobody is approved.",
        };
      } else if (cages.size === 1) {
        standing = { kind: "sole", cages: [...cages] };
      } else {
        standing = { kind: "multiple", count: cages.size };
      }
    }

    return {
      solicitation: r.solicitation,
      nsn: r.nsn,
      niin: r.niin,
      nomenclature: r.nomenclature,
      quantity: r.quantity,
      unitOfIssue: r.unitOfIssue,
      returnDate: r.returnDate,
      purchaseRequest: r.purchaseRequest,
      automated: form?.automated ?? null,
      standing,
      /*
       * `onNewestDay` is true by construction: every row here comes from the served day's index,
       * which IS the newest servable day. It is passed explicitly rather than hardcoded inside
       * the judgement so the sentence this feeds stays correct if the board ever widens.
       */
      lifecycle: lifecycleAsOf({
        closeDate: parseIndexReturnDate(r.returnDate, served.feedDay).iso,
        onNewestDay: true,
        asOf,
      }),
    };
  });

  // Interest ordering, from measured signal only. A corner is sole-sourced AND machine-awarded.
  const rank = (row: BoardRow): number => {
    const sole = row.standing.kind === "sole" ? 2 : 0;
    const auto = row.automated === true ? 1 : 0;
    return sole + auto;
  };
  rows.sort((a, b) => rank(b) - rank(a) || a.solicitation.localeCompare(b.solicitation));

  const counts = {
    published: rows.length,
    automated: rows.filter((r) => r.automated === true).length,
    soleSourced: rows.filter((r) => r.standing.kind === "sole").length,
    corners: rows.filter((r) => r.standing.kind === "sole" && r.automated === true).length,
    unjoined: rows.filter((r) => r.standing.kind === "unjoined").length,
    open: rows.filter((r) => r.lifecycle.status === "open").length,
    closed: rows.filter((r) => r.lifecycle.status === "closed").length,
    undated: rows.filter((r) => r.lifecycle.status === "last_seen_only").length,
  };

  const built: BoardData = {
    ok: true,
    feedDay: served.feedDay,
    heldButNotServable: served.skipped,
    daysHeld: served.daysHeld,
    rows,
    counts,
    asOf,
    asOfBasis,
    drift: {
      offWidthRows: index.offWidthRows,
      unparsedNsn: index.unparsedNsn,
      unparsedSourceLines: sources.unparsedLines,
    },
  };
  cache.set(key, built);
  return built;
}
