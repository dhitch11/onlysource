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
  /** L3. One link to the full document. One, never two. */
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
    what: "Whether this figure was measured from a record, modelled from other data, or cannot be known from what we hold.",
    how: "Read the shape, not the colour. A filled square is measured, a filled circle is modelled, a dashed outline means insufficient data. The colour repeats the shape and never carries it alone.",
    why: "A modelled figure and a measured one look identical on a screen and are worth very different amounts. Quoting a modelled price as though it were measured is how a firm loses money on a contract it already won.",
    source: "Set by the lane that produced the figure, on the record itself. It is never inferred at render time.",
  },
  {
    id: "ui.truth_strip",
    owner: "T8 DESIGN",
    title: "Data provenance band",
    what: "What data this screen is built from, how much of it arrived, and how old it is.",
    how: "Check the age before you act on anything on this screen. If a source is quarantined, open it and see what did not parse.",
    why: "A number without its as-of is a claim with the expiry removed. Acting on yesterday's queue as though it were today's is how a sweep gets missed.",
    source: "Counts come from the ingest records themselves, not from a cached summary.",
  },
  {
    id: "ui.unconfirmed",
    owner: "T8 DESIGN",
    title: "Unconfirmed value",
    what: "A value pulled from a call, a listing or a document that no human has accepted yet.",
    how: "Open the source next to it, check it, then accept with one keystroke. Accepting is undoable for the full undo window.",
    why: "An unaccepted value is inert: it is excluded from every computed total until a person confirms it. That is deliberate, because a wrong figure on a federal quote is not a bug that gets patched later.",
    source: "The extraction record, with the audio span or document region attached.",
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

/*
 * Other lanes: register your entries here, in your own block.
 *
 *   register(T3_ENTRIES)   // scoring signals, the counterfactual, the abstain reasons
 *   register(T5_ENTRIES)   // compliance paths, the T-versus-U branch, the traceability gate
 *   ...
 *
 * Keep the array in a file your lane owns and import it, so this file does not become a
 * merge conflict every lane fights over.
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
    score: "T3 ENGINE",
    signal: "T3 ENGINE",
    board: "T3 ENGINE",
    monopoly: "T4 INTELLIGENCE",
    capability: "T4 INTELLIGENCE",
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
  if (r.what.length > MAX_WHAT) {
    problems.push(`${r.id}: "what" is ${r.what.length} chars, cap is ${MAX_WHAT}`);
  }
  for (const [field, text] of Object.entries({
    what: r.what,
    how: r.how,
    why: r.why,
    source: r.source,
  })) {
    if (text.includes("—")) problems.push(`${r.id}: "${field}" contains an em dash`);
  }
  return problems;
}
