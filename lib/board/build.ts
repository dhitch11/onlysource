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
  };
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

export function buildBoard(): BoardData | BoardUnavailable {
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
  const key = `${served.feedDay}|${served.indexStorageKey}|${served.archive.storageKey}`;
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
  };

  const built: BoardData = {
    ok: true,
    feedDay: served.feedDay,
    heldButNotServable: served.skipped,
    daysHeld: served.daysHeld,
    rows,
    counts,
    drift: {
      offWidthRows: index.offWidthRows,
      unparsedNsn: index.unparsedNsn,
      unparsedSourceLines: sources.unparsedLines,
    },
  };
  cache.set(key, built);
  return built;
}
