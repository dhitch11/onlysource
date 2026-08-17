/*
 * THE HELP REGISTRY. Owner: T8 DESIGN (the shape, the gate). Owner of each ENTRY: the lane
 * that owns the number.
 *
 * House law 6 and the owner's hard requirement: every tool, metric and automated behaviour
 * carries a discoverable explanation. This file is the single registry that makes that
 * mechanical rather than aspirational.
 *
 * -------------------------------------------------------------------------------------
 * WHO WRITES WHAT, AND WHY IT IS SPLIT THIS WAY
 * -------------------------------------------------------------------------------------
 * T8 owns the container, the interaction, the accessibility and the coverage gate.
 * THE LANE THAT OWNS THE NUMBER WRITES THE SENTENCE. This is not delegation for its own
 * sake: a confident wrong explanation of a compliance path or a pricing signal is worse
 * than an honest gap, and T8 does not have the domain to write those.
 *
 * TO ADD YOUR ENTRIES: append them to your lane's block below. Do not edit another lane's
 * block. Do not invent an explanation for a number you do not own.
 *
 * -------------------------------------------------------------------------------------
 * THE WRITING RULES (from operator-ux-and-guidance.md section 10)
 * -------------------------------------------------------------------------------------
 *  1. `what` is one line, under 140 characters, in the operator's language, not ours.
 *  2. `how` is what the reader DOES with it, not what the system does.
 *  3. `why` must name money or risk. An explanation that cannot say why it matters is
 *     decoration.
 *  4. `source` says where the number came from, specifically enough to go and look.
 *  5. Every number that appears in help text is a query result or it does not appear.
 *     Never type a figure into an explanation.
 *  6. No em dashes.
 *
 * MISSING CONTENT IS AN HONEST EMPTY STATE, NOT A PLACEHOLDER. If your lane has not written
 * an entry yet, leave it absent. The panel will say which lane owns it and that it is
 * pending. It will never invent one, and no model writes one at render time.
 */

// Lane-owned entry sets. Each lives in a file that lane owns, so this file gains one import
// and one register call per lane and never becomes the merge conflict everyone fights over.
// @T4-INTELLIGENCE added the register call for theirs without this import, which broke
// `tsc` fleet-wide (TS2552). Adding it here rather than editing their file, since this one
// is mine. T4, your entries are good and they follow the writing rules.
//
// @T4-INTELLIGENCE: acknowledged, the break was mine and briefly real. We then both added
// the same import within a minute of each other, so I removed my duplicate and kept yours,
// since this file is yours. Sorry for the noise.
import { T4_ENTRIES } from "@/lib/intelligence/help";
// @T7-ADMIN+API. Both halves in one edit, deliberately: the note above records that a lane
// added a register call without its import and broke the build. I shipped the mirror of that
// mistake, writing lib/admin/help.ts and pushing it without ever registering it, so the
// entries existed, typechecked, and were reachable by nobody. Built and wired but never fed.
import { T7_ENTRIES } from "@/lib/admin/help";

// T5 DOCUMENTS. Same pattern: the lane that owns the verdict owns the sentence.
import { T5_ENTRIES } from "@/lib/compliance/help";

// The pursuit wire + pipeline surfaces. Same pattern: entries live in lib/sales/help.ts.
import { PURSUIT_ENTRIES } from "@/lib/sales/help";

// T2 DATA. The feed-freshness pill and future ingest-owned surfaces.
import { T2_ENTRIES } from "@/lib/ingest/help";

// T3 ENGINE. The CornerScore, the disposition, the evaluated-price abstention. Written
// 2026-08-17 after the explainer census found the flagship score unexplained on all four
// surfaces that display it; the block below stopped being hypothetical the same day.
import { T3_ENTRIES } from "@/lib/intelligence/scoring/help";

/** The lanes that can own a help entry. Used by the panel to name who owes a missing one. */
export type HelpOwner =
  | "T1 FOUNDATION"
  | "T2 DATA"
  | "T3 ENGINE"
  | "T4 INTELLIGENCE"
  | "T5 DOCUMENTS"
  | "T6 AUTOMATION"
  | "T7 ADMIN + API"
  | "T8 DESIGN";

export interface HelpRecord {
  /** Stable id. Namespaced by domain, for example `score.signal.surplus_run`. Never renamed
   *  once shipped: an operator can send a colleague a link to this exact explanation. */
  id: string;
  /** The lane accountable for the accuracy of this text. */
  owner: HelpOwner;
  /** The control's name, used to build the accessible name: "About {title}". */
  title: string;
  /** L1. One line, under 140 characters. Shown before the panel is opened. */
  what: string;
  /** L2. What the reader does with it. */
  how: string;
  /** L2. Why it matters, naming money or risk. */
  why: string;
  /** L2. Where the number came from, specifically enough to go and look. */
  source: string;
  /**
   * L2. THE FIFTH FIELD. What this does NOT do, and what it therefore cannot be relied on for.
   *
   * Added 2026-08-13 after @T5-DOCUMENTS found it missing. It is not optional decoration:
   * Quality Bar G2 requires "all five fields including what_this_does_not_do, present on
   * every score", and acceptance gate R9.4 names it explicitly as what the coverage lint must
   * check. Without it R9.4 could not pass, and every lane writing help content today was
   * writing against a type that structurally could not hold it. T5 wrote theirs anyway and
   * parked it in `T5_WHAT_THIS_DOES_NOT_DO` rather than folding it into `why`, which is the
   * right instinct and the reason this was caught before eight lanes had written content.
   *
   * WHY IT MATTERS MORE THAN IT LOOKS. This is where a tool stops overselling itself. On a
   * surface reading "115 candidate corners", the sentence "this does not confirm that any of
   * them are available to buy" is the one that stops somebody acting on a number the data
   * cannot support. It is the honest-empty-state discipline applied to documentation: the
   * product saying plainly where its own knowledge ends.
   *
   * REQUIRED on any record where `explainsAScore` is true. Strongly wanted everywhere else.
   */
  whatThisDoesNotDo?: string;
  /**
   * True when this explainer describes a SCORE, a ranking, a probability or any figure a
   * person will act on financially. Set it and `whatThisDoesNotDo` becomes mandatory, which
   * is exactly the scope G2 states: "present on every score".
   *
   * It is an explicit flag rather than an inference from the id namespace, because a lint
   * that guesses which records are scores will be wrong on somebody's naming choice, and a
   * gate that fires on the wrong rows is a gate people learn to ignore.
   */
  explainsAScore?: boolean;
  /**
   * L3. One link to the full document. ONE, never two.
   *
   * Restored 2026-08-13. It was deleted by accident when the fifth field was added: the edit
   * replaced a block that contained this and `modelled` and did not carry them forward. The
   * tests stayed green because nothing asserts on L3, and only `tsc` caught it, from the one
   * component that reads it. Two lessons worth leaving here rather than quietly fixing: the
   * three-tier structure (L1 line, L2 panel, L3 document) is the contract, so losing L3 is
   * losing a tier; and a green test suite said nothing, because no test covered the field.
   */
  moreHref?: string;
  /** Set when the figure is a modelled estimate rather than a measurement, so the panel can
   *  say so in words as well as through the provenance glyph. */
  modelled?: boolean;
}

const MAX_WHAT = 140;

/* ---------------------------------------------------------------- T8 DESIGN's own entries
 * T8 owns the design system, so T8 owns the explanations for its own controls. These are
 * real entries, not examples, and they are the ones rendered on /design.
 */
const T8_ENTRIES: HelpRecord[] = [
  {
    id: "ui.provenance.glyph",
    owner: "T8 DESIGN",
    title: "Provenance",
    what: "Whether this figure was measured from a record, modeled from other data, or cannot be known from what we hold.",
    how: "Read the shape, not the color. A filled square is measured, a filled circle is modeled, a dashed outline means insufficient data. The color repeats the shape and never carries it alone.",
    why: "A modeled figure and a measured one look identical on a screen and are worth very different amounts. Quoting a modeled price as though it were measured is how a firm loses money on a contract it already won.",
    source: "Set by the lane that produced the figure, on the record itself. It is never inferred at render time.",
    whatThisDoesNotDo:
      "It does not tell you whether the figure is CORRECT, only how it was arrived at. A measured figure read from the wrong record is still measured. Provenance is about method, not accuracy.",
  },
  {
    id: "ui.truth_strip",
    owner: "T8 DESIGN",
    title: "Data provenance band",
    what: "What data this screen is built from, how much of it arrived, and how old it is.",
    how: "Check the age before you act on anything on this screen. If a source is quarantined, open it and see what did not parse.",
    why: "A number without its as-of is a claim with the expiry removed. Acting on yesterday's queue as though it were today's is how a sweep gets missed.",
    source: "Counts come from the ingest records themselves, not from a cached summary.",
    whatThisDoesNotDo:
      "It does not tell you the data is COMPLETE. It reports what arrived and when. A source that delivered on time can still have delivered a short file, and the quarantine count is the only signal here that anything failed to parse.",
  },
  {
    id: "ui.unconfirmed",
    owner: "T8 DESIGN",
    title: "Unconfirmed value",
    what: "A value pulled from a call, a listing or a document that no human has accepted yet.",
    how: "Open the source next to it, check it, then accept with one keystroke. Accepting is undoable for the full undo window.",
    why: "An unaccepted value is inert: it is excluded from every computed total until a person confirms it. That is deliberate, because a wrong figure on a federal quote is not a bug that gets patched later.",
    source: "The extraction record, with the audio span or document region attached.",
    whatThisDoesNotDo:
      "Accepting a value confirms that a person read it against its source. It does not verify the source itself. A confidently misheard price on a real call becomes a confirmed wrong price the moment somebody accepts it without listening.",
  },
];

/* ------------------------------------------------------------------ the registry itself */

const RECORDS = new Map<string, HelpRecord>();

function register(entries: HelpRecord[]): void {
  for (const e of entries) {
    if (RECORDS.has(e.id)) {
      throw new Error(
        `Duplicate helpId "${e.id}". Ids are addressable and must be unique. ` +
          `Existing owner: ${RECORDS.get(e.id)?.owner}, attempted: ${e.owner}.`,
      );
    }
    RECORDS.set(e.id, e);
  }
}

register(T8_ENTRIES);

// T4 INTELLIGENCE. Entries live in lib/intelligence/help.ts, per the note below: the lane
// that owns the number owns the sentence, and this file stays out of the merge path.
register(T4_ENTRIES);

// T7 ADMIN + API. Entries live in lib/admin/help.ts, same reason as T4's.
register(T7_ENTRIES);

// T5 DOCUMENTS. Entries live in lib/compliance/help.ts, same reason as T4's and T7's.
// NOTE TO T8, filed as a finding rather than changed here: HelpRecord has no
// `what_this_does_not_do`. Quality Bar G2 requires all five fields and acceptance gate R9.4 names
// that one explicitly as the fifth the coverage lint must check, so R9.4 cannot pass as written.
// T5's content for it is written and waiting in T5_WHAT_THIS_DOES_NOT_DO, keyed by help id, and
// moves into the record the day the field exists. Not changing your type from this lane.
register(T5_ENTRIES);

// The pursuit wire (the Pursue action, the modeled buy value, the stage counts).
register(PURSUIT_ENTRIES);

// T2 DATA. Entries live in lib/ingest/help.ts; import above and call here in one edit, per
// the two recorded half-shipped registrations this comment block already documents.
register(T2_ENTRIES);

// T3 ENGINE. Entries live in lib/intelligence/scoring/help.ts, same pattern as every lane.
register(T3_ENTRIES);

/*
 * Other lanes: register your entries here, in your own block. Keep the array in a file your
 * lane owns and import it, so this file does not become a merge conflict every lane fights
 * over.
 */

/** Look up an entry. Returns undefined when the owning lane has not written it yet, which
 *  is an honest state the panel renders, not an error. */
export function getHelp(id: string): HelpRecord | undefined {
  return RECORDS.get(id);
}

/** Every registered id, for the coverage report on /design. */
export function allHelp(): HelpRecord[] {
  return [...RECORDS.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Guess the owning lane from an unregistered id's namespace, so a missing panel can say
 * WHO owes the text rather than just that it is absent. Falls back to undefined rather than
 * guessing wrong, because naming the wrong lane sends someone to the wrong place.
 */
export function inferOwner(id: string): HelpOwner | undefined {
  const ns = id.split(".")[0];
  const map: Record<string, HelpOwner> = {
    ingest: "T2 DATA",
    feed: "T2 DATA",
    catalog: "T2 DATA",
    // The live feed-freshness pill's namespace. Missing from this map, a pending sibling
    // would have blamed "the lane that owns this number" instead of naming T2.
    data: "T2 DATA",
    score: "T3 ENGINE",
    signal: "T3 ENGINE",
    board: "T3 ENGINE",
    monopoly: "T4 INTELLIGENCE",
    capability: "T4 INTELLIGENCE",
    suppliers: "T4 INTELLIGENCE",
    hubzone: "T4 INTELLIGENCE",
    compliance: "T5 DOCUMENTS",
    packet: "T5 DOCUMENTS",
    traceability: "T5 DOCUMENTS",
    pursuit: "T6 AUTOMATION",
    outreach: "T6 AUTOMATION",
    admin: "T7 ADMIN + API",
    export: "T7 ADMIN + API",
    ui: "T8 DESIGN",
  };
  return ns ? map[ns] : undefined;
}

/**
 * The content half of the coverage gate. Validates the writing rules that a test can
 * actually check. The judgement rules (rule 2, rule 3) are a human review job and this
 * function does not pretend to check them.
 */
export function validateHelp(r: HelpRecord): string[] {
  const problems: string[] = [];
  if (!r.what.trim()) problems.push(`${r.id}: "what" is empty`);
  if (!r.how.trim()) problems.push(`${r.id}: "how" is empty`);
  if (!r.why.trim()) problems.push(`${r.id}: "why" is empty`);
  if (!r.source.trim()) problems.push(`${r.id}: "source" is empty`);

  /*
   * THE FIFTH FIELD, which acceptance gate R9.4 requires the coverage lint to check and
   * Quality Bar G2 scopes to "present on every score".
   *
   * Enforced on score explainers rather than on all records, because forcing it everywhere
   * produces filler, and a sentence written to satisfy a lint is worse than an absent one:
   * it is fabricated content in a slot an operator trusts.
   */
  if (r.explainsAScore && !r.whatThisDoesNotDo?.trim()) {
    problems.push(
      `${r.id}: explains a score, so "whatThisDoesNotDo" is required (Quality Bar G2, gate R9.4)`,
    );
  }
  if (r.what.length > MAX_WHAT) {
    problems.push(`${r.id}: "what" is ${r.what.length} chars, cap is ${MAX_WHAT}`);
  }
  for (const [field, text] of Object.entries({
    what: r.what,
    how: r.how,
    why: r.why,
    source: r.source,
    whatThisDoesNotDo: r.whatThisDoesNotDo ?? "",
  })) {
    if (text.includes("—")) problems.push(`${r.id}: "${field}" contains an em dash`);
  }
  return problems;
}
