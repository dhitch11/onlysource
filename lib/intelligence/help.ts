/**
 * THE INFORMATION AFFORDANCE CONTENT FOR THIS LANE'S SURFACES.
 *
 * T8 owns the container, the interaction, the accessibility and the coverage gate. This lane
 * owns the SENTENCES, because a confident wrong explanation of a corner or a supplier signal
 * is worse than an honest gap, and only the lane that owns the number can write it.
 *
 * The entries live here rather than inside T8's registry file so that ownership matches the
 * directory: T8's file gains an import and a register call, nothing more.
 *
 * ---------------------------------------------------------------------------------------
 * THE RULE THAT SHAPED EVERY SENTENCE BELOW
 * ---------------------------------------------------------------------------------------
 * Registry writing rule 5: every number that appears in help text is a query result or it
 * does not appear. So there is not one hardcoded figure in this file. The counts belong on
 * the surface, computed, next to their source. Help explains what a number MEANS and what
 * would change it; it never restates the number, because a restated number goes stale
 * silently and then contradicts the screen it is explaining.
 *
 * On this lane the affordance carries five answers rather than three, because these surfaces
 * ask people to bet inventory. `source` carries the fourth (where did this come from) and
 * `why` carries the fifth (what would change this answer) wherever a counterfactual is the
 * honest thing to say.
 */

import type { HelpRecord } from '@/components/help/registry'

export const T4_ENTRIES: HelpRecord[] = [
  /* ------------------------------------------------------------------ the map itself */
  {
    id: 'monopoly.map',
    owner: 'T4 INTELLIGENCE',
    title: 'Monopoly Map',
    what: 'Stock numbers the government still buys where the approved manufacturer appears to have stopped trading.',
    how: 'Work the top band first. Open a row to read the evidence behind it, then decide whether to go looking for the remaining material.',
    why: 'A position taken before the requirement is written does not have to be won in a race. This is the surface where inventory gets bought early and cheaply.',
    source: 'The approved-source file published inside the daily quoting package, crossed with the daily solicitation index and a trailing award-silence list. Each row names its own inputs and the date each was observed.',
  },
  {
    id: 'monopoly.candidate_corner',
    owner: 'T4 INTELLIGENCE',
    title: 'Candidate corner',
    what: 'One approved source, live demand today, and that source shows no recent recorded award activity.',
    how: 'Treat it as a position worth an hour of sourcing, not as a decision. Check who else could reach the same conclusion from the same public data before you commit capital.',
    why: 'This is the shape of the trade the corpus documents: several surplus dealers competing a price down, one of them bought out, and the buyer becomes the only source. It is also the shape of an expensive mistake if the source is alive.',
    source: 'Approved-source mapping for the feed day, the solicitation index for demand, and the award-silence list for the source signal. Open the row to read the literal records.',
  },

  /* ------------------------------------------------- the three honest states that matter */
  {
    id: 'monopoly.source_status_unknown',
    owner: 'T4 INTELLIGENCE',
    title: 'Source status unknown',
    what: 'We could not resolve whether this approved source is still trading, so no claim is made either way.',
    how: 'Read it as a gap to close, not as a weak yes. Resolving the company is usually a phone call or a registration lookup.',
    why: 'An unresolved source counted as dead manufactures a corner that does not exist, and the operator buys stock against it. Rows in this state are deliberately excluded from the headline count.',
    source: 'Absence of a resolvable status record for the company code on this row.',
  },
  {
    id: 'monopoly.award_silence',
    owner: 'T4 INTELLIGENCE',
    title: 'No recorded award activity',
    what: 'No prime award is recorded for this company in the public data over the trailing window. That is a measurement, not proof the firm has gone.',
    how: 'Use it to rank who to call first. Confirm the firm directly before treating it as an exit.',
    why: 'Federal award reporting is not required at or below the micro-purchase threshold, so a dealer of exactly our size can be winning awards every month and show total public silence. Reading silence as death sends a buyer at a firm that is thriving.',
    source: 'A trailing award-silence export keyed on company code. The row carries the last recorded award date where the export supplies one.',
  },
  {
    id: 'monopoly.availability_unknown',
    owner: 'T4 INTELLIGENCE',
    title: 'Availability not read',
    what: 'Present market availability is not connected, so the thin-availability leg of the corner test could not be evaluated.',
    how: 'Check availability by hand for any row you intend to act on. Do not read a high position in this list as a confirmed corner.',
    why: 'Thin availability is what makes a corner buyable. Without it a row is a candidate only, and treating a candidate as confirmed is how capital gets committed against a position anyone can still supply.',
    source: 'No commercial locator credential is connected. This is an absent input, not a measured zero.',
  },
  {
    id: 'monopoly.legs_established',
    owner: 'T4 INTELLIGENCE',
    title: 'Legs established',
    what: 'How many of the three corner tests could actually be evaluated for this row: demand, source status, and present availability.',
    how: 'Sort by it. A row that establishes more legs is better evidenced, not necessarily more valuable.',
    why: 'It separates a weak position from a position we simply could not finish checking, which are different reasons to pass and lead to different next actions.',
    source: 'Computed from which inputs returned a value for this row. The availability leg cannot contribute while no locator credential is connected.',
  },

  /* ------------------------------------------------------------------ the other surfaces */
  {
    id: 'monopoly.inversion',
    owner: 'T4 INTELLIGENCE',
    title: 'Manufacturer view',
    what: 'Pick a company and see every stock number it is the approved source for, with its status and which of those items still have demand.',
    how: 'Start from a source you believe is winding down, then read down its items for the ones the government still buys.',
    why: 'It surfaces every position behind one dead source at once, before any solicitation posts. That is the pre-emptive move rather than the reactive one.',
    source: 'The approved-source mapping inverted from item-to-company into company-to-item. Same records as the map, read the other way.',
  },
  {
    id: 'capability.no_quote',
    owner: 'T4 INTELLIGENCE',
    title: 'No-quote solicitations',
    what: 'Requirements the agency issued that drew no quotes at all, split by whether anybody is showing material against them.',
    how: 'Work the ones where somebody holds material as a sourcing job. Send the rest to the capability match, because those need somebody to build the part.',
    why: 'The make-side half is the class the customer sized in the millions, and the reason a person cannot work it is that each one can burn hours and end with no path to the part.',
    source: 'The no-quote solicitation export joined to the supplier availability snapshot on a normalised solicitation number.',
  },
  {
    id: 'capability.granularity',
    owner: 'T4 INTELLIGENCE',
    title: 'Evidence granularity',
    what: 'Whether the evidence for a shop is about this exact item or only about its supply class.',
    how: 'Weight an item-level match far above a class-level one when you decide who to approach.',
    why: 'An approved-source record proves a shop was trusted with this exact part. A class-level award only proves it works in the category, and treating them as equal produces a ranked list the principal will not act on twice.',
    source: 'Approved-source records are item level. Public award feeds carry supply class rather than stock number, so links drawn from them are class level and render weaker.',
  },
  {
    id: 'monopoly.evidence_class',
    owner: 'T4 INTELLIGENCE',
    title: 'Evidence class',
    what: 'How strong the basis for a claim is, from a relationship the government recorded down to context that is never sufficient alone.',
    how: 'Set the floor you are willing to act on. A fastener and a flight-critical item do not deserve the same threshold.',
    why: 'A missed match costs an opportunity. A false match ships the wrong metal against a federal contract. Those are not symmetric, and this control is where that asymmetry gets set.',
    source: 'Assigned by the named rule that generated the claim. The rule appears on every row and never renders as an unattributed score.',
  },
  {
    id: 'monopoly.verdict',
    owner: 'T4 INTELLIGENCE',
    title: 'Equivalence verdict',
    what: 'The result of comparing two items attribute by attribute: identical, confirmed with exceptions, insufficient data, or a conflict.',
    how: 'Read the conflicts and the attributes present on only one side before you accept a match. Those are the rows a human has to decide.',
    why: 'Insufficient data is a real and common answer here, and it is the honest one when the catalog does not carry enough shared attributes. A verdict set with no abstention in it is a system that is guessing.',
    source: 'A deterministic comparison over the characteristics records for both items. No language model produces this verdict, and none may introduce an attribute the comparison did not contain.',
  },
]
