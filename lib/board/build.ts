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
import { readFileSync, existsSync } from "node:fs";
import { readDailyIndex, readApprovedSourceFile } from "@/lib/intelligence/seed/feed";
import { parseSolicitation } from "@/lib/intelligence/niin";
import { archivePath } from "@/lib/data-root";

const FEED_DAY = "2026-08-11";

/**
 * The INDEX is fixed-width and lives under the dated capture directory. The `bq` file beside
 * it is the CSV quoting file and is a different shape entirely; joining against it produces
 * 3,274 unreadable rows that look like data.
 *
 * The capture directory is pinned, NOT resolved as "the newest". A later capture of this day
 * is a 141-byte fixture of X characters, written by a truncation test, and taking the newest
 * timestamp silently loads it. A guard below refuses any index that fails the published shape.
 *
 * Paths resolve through lib/data-root at call time: the data directory is gitignored and
 * shipped out of band, so the location is asked for at runtime rather than hardcoded to a home
 * directory. The retrieval subtree shape is preserved because it is part of the provenance.
 */
const INDEX_FILE = archivePath("dibbs-rfq-daily", FEED_DAY, "20260812T225616Z", "in260811.txt");
const SOURCE_FILE = archivePath("derived", "dibbs-rfq-daily", FEED_DAY, "as260811.txt");

/** A working DLA day runs roughly 1,960 to 3,095 requirement lines. Well below that is a
 *  truncated or substituted file, and it must fail loudly rather than render as a quiet day. */
const MIN_PLAUSIBLE_ROWS = 500;

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

let cache: BoardData | BoardUnavailable | null = null;

export function buildBoard(): BoardData | BoardUnavailable {
  if (cache) return cache;

  const missing = [INDEX_FILE, SOURCE_FILE].filter((f) => !existsSync(f));
  if (missing.length > 0) {
    cache = {
      ok: false,
      reason:
        "The daily government feed for this day is not on disk. The Board renders what DLA published, so with no file there is nothing to show, and nothing has been assumed in its place.",
      missing,
    };
    return cache;
  }

  const index = readDailyIndex(INDEX_FILE);
  const sources = readApprovedSourceFile(SOURCE_FILE);

  // Refuse a file that cannot be a real working day, rather than render it as a quiet one.
  // A row-boundary truncation parses perfectly cleanly, so a short count is the only evidence.
  if (index.rows.length < MIN_PLAUSIBLE_ROWS) {
    cache = {
      ok: false,
      reason: `The index file for this day carries only ${index.rows.length} rows. A working DLA day runs into the thousands, so this file is truncated or substituted. It is being refused rather than shown as a quiet day.`,
      missing: [INDEX_FILE],
    };
    return cache;
  }
  // Every row off-width means the file is not the fixed-width index at all.
  if (index.rows.length > 0 && index.offWidthRows >= index.rows.length) {
    cache = {
      ok: false,
      reason:
        "Every line in the index file failed the published 140 character width, so this is not the fixed-width index. Nothing has been inferred from it.",
      missing: [INDEX_FILE],
    };
    return cache;
  }

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

  cache = {
    ok: true,
    feedDay: FEED_DAY,
    rows,
    counts,
    drift: {
      offWidthRows: index.offWidthRows,
      unparsedNsn: index.unparsedNsn,
      unparsedSourceLines: sources.unparsedLines,
    },
  };
  return cache;
}
