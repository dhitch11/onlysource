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
    source: 'The no-quote solicitation export joined to the supplier availability snapshot on a normalized solicitation number.',
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

  /* ------------------------------------------------ jargon that appears next to a number */
  {
    id: 'monopoly.ils',
    owner: 'T4 INTELLIGENCE',
    title: 'ILS',
    what: 'The Inventory Locator Service, the commercial marketplace where parts stock is searched and confirmed across suppliers.',
    how: 'Wherever a row says "not ILS-confirmed", read the listed stock as a claim a company typed in, not a shelf anyone has checked. Confirm by hand before committing capital.',
    why: 'A corner is only buyable when nobody else can actually supply the part. Self-reported listings overstate and understate real shelves in both directions, so acting on them unchecked risks buying into a position anyone can fill.',
    source: 'No ILS credential is connected in this build, which is why the feasibility leg abstains and the confirmed-corner count stays at zero.',
    whatThisDoesNotDo:
      'Nothing on these surfaces checks a real shelf. Absence of a listing is not proof no stock exists, and a listing is not proof it does.',
  },
  {
    id: 'monopoly.cage',
    owner: 'T4 INTELLIGENCE',
    title: 'CAGE code',
    what: 'A five-character Commercial and Government Entity code, the government ID for one company at one location.',
    how: 'Use the code, not the company name, when you trace a source across surfaces. Names drift and repeat; the code is the stable key every government record carries.',
    why: 'Two suppliers can share a name and one supplier can trade under several. Chasing the wrong entity wastes the hour, or worse, prices a deal against the wrong company.',
    source: 'Read from the government files as published. Every join in this product keys on the code and shows the name only for display.',
  },
  {
    id: 'monopoly.surplus_drag',
    owner: 'T4 INTELLIGENCE',
    title: 'Surplus evaluated-drag',
    what: 'How much the flat evaluation penalty on surplus offers costs as a share of this buy, at its last award price and quantity.',
    how: 'Read it before quoting surplus. A small percentage means the penalty barely moves the comparison; a large one means a surplus offer starts the race from behind.',
    why: 'DIBBS evaluates a surplus offer with a flat added cost, so on a small buy the penalty can be the whole margin. Knowing the drag decides whether surplus material can win the award at all.',
    source: 'Computed from the last award unit price and the open quantity on this row. The flat adder is the standard surplus evaluation charge; the row states whether it is negligible or meaningful for this buy.',
  },

  /* ------------------------------------------- the decide-surface charts and columns
   * Added 2026-08-17 after the explainer census: the Board's award-path column, the
   * Intelligence charts, the modeled dollar totals on Goldmine and HUBZone, and the
   * Suppliers prospect score all rendered with no explanation anywhere. */
  {
    id: 'monopoly.award_path',
    owner: 'T4 INTELLIGENCE',
    title: 'Award path',
    what: 'Whether this buy is awarded by machine on price alone, or evaluated manually by a person. Read from the solicitation type character.',
    how: 'Work machine-award rows with a sharp price, because nothing but the number competes. On manual rows, expect a person to read your quote and its paperwork before anything is won.',
    why: 'A machine award is the shape a corner monetizes through: set the price, win the buy. Spending that effort on a manually evaluated buy misjudges who is listening.',
    source: 'The ninth character of the solicitation number in the feed-day index; T and U mark the automated instruments. A row whose solicitation cannot name the character says unknown instead of guessing.',
    whatThisDoesNotDo:
      'It does not say the machine will pick you, and it says nothing about surplus eligibility, which turns on the T versus U branch separately.',
  },
  {
    id: 'monopoly.supply_chain',
    owner: 'T4 INTELLIGENCE',
    title: 'Supply chains',
    what: 'Which DLA supply chains the cornered parts belong to, counted from the forecast records those corners matched.',
    how: 'Work the biggest chain first. One credentialed relationship or one line of stock often serves many corners inside the same chain.',
    why: 'Concentration is leverage. Ten corners in one chain can share suppliers, paperwork and a buyer; ten corners in ten chains are ten separate jobs.',
    source: 'The supply chain named on the DLA Forecast rows for each cornered stock number, counted once per corner per chain. Corners with no forecast rows contribute nothing.',
  },
  {
    id: 'monopoly.price_escalation',
    owner: 'T4 INTELLIGENCE',
    title: 'Price escalation',
    what: 'How much the sole source has raised the unit price across this part\'s own award history, first recorded award to latest.',
    how: 'Read it as the rent an uncontested lane charges. Open the row and check the dates and quantities behind the two prices before quoting against the trend.',
    why: 'A steep escalation on a machine-award buy is the clearest money signal on these surfaces: the incumbent is pricing without competition, and a sharper price can take the lane.',
    source: 'Computed from the first and latest recorded award unit prices in the loaded procurement history for this stock number. A part with fewer than two priced awards carries no escalation figure.',
    whatThisDoesNotDo:
      'It does not say why the price rose. Quantity changes, spec changes and inflation all move unit prices, and none of them is a corner. Two awards make a line, not a law.',
    explainsAScore: true,
  },
  {
    id: 'capability.modeled_size_of_buy',
    owner: 'T4 INTELLIGENCE',
    title: 'Modeled size of buy',
    what: 'The last recorded government price times the quantity asked for, added up. A model of how much money the buys represent, not a quote.',
    how: 'Use it to rank which lanes deserve the hour. Before quoting any single row, open it and check the price history behind the model.',
    why: 'A ranked dollar model is how a two-person shop picks its lane. A modeled total mistaken for promised revenue is how it overcommits capital.',
    source: 'Measured per row from the government files: the last recorded price times the quantity on the solicitation line. A row missing either leg, the price or the quantity, contributes nothing to the total and is listed separately as an unknown size. A quantity nobody published is not a quantity of one.',
    whatThisDoesNotDo:
      'It does not promise the next award will price or size the same. The government can buy fewer, pay less, or not buy at all. It also does not rank an unsized buy against a sized one: those are listed apart, ordered by the quantity the government did publish, because there is no measured basis for placing an unknown against a dollar figure in either direction.',
    modelled: true,
    explainsAScore: true,
  },
  {
    id: 'suppliers.prospect_score',
    owner: 'T4 INTELLIGENCE',
    title: 'Prospect score',
    what: 'The researcher\'s rank of how likely this company is to hold dead inventory worth buying, carried through from the workbook unchanged.',
    how: 'Sort by it and call the top band first. Read the rationale on the row before an approach, and mark a company contacted so the next pass skips it.',
    why: 'An hour of calls placed by rank finds stock an alphabetical pass misses. Treating the rank as a fact about inventory, rather than a bet on where to look, buys positions nobody verified.',
    source: 'The researched supplier workbook on disk, score and tier exactly as the researcher recorded them. Nothing in this build rescored the rows.',
    whatThisDoesNotDo:
      'It does not measure inventory and it is not a company health record. Silence is a signal, not proof a company is gone, and a high score confirms nothing until a person reaches the company.',
    explainsAScore: true,
  },

  /* --------------------------------------- the dashboard command-center tiles (T4 numbers) */
  {
    id: 'monopoly.forecast_nsns',
    owner: 'T4 INTELLIGENCE',
    title: 'NSNs on the DLA Forecast',
    what: 'How many stock numbers in the loaded export appear on the DLA Forecast, the government list of parts it plans to buy again.',
    how: 'Treat forecast presence as stated forward demand. Filter the Monopoly Map to "On forecast" to work the corners the buyer has already said it will return for.',
    why: 'A corner with stated future demand is worth holding; one without it may never be bought again. This split decides where inventory dollars wait and where they die.',
    source: 'Counted from the DLA Forecast sheets inside the NSN-Now export on disk, keyed by stock number. The line under this sentence names the exact files and the feed day this count was read from.',
    whatThisDoesNotDo:
      'It does not promise a purchase. A forecast line is a plan, not an order, and absence from the forecast is not proof demand is gone.',
  },
  {
    id: 'monopoly.award_history_nsns',
    owner: 'T4 INTELLIGENCE',
    title: 'NSNs with award history',
    what: 'How many stock numbers carry at least one real recorded award in the loaded export, giving a price the government actually paid.',
    how: 'Use these rows to anchor any quote: the price history and its trend are measured, not modeled. Rows outside this count abstain on price rather than guessing.',
    why: 'A real paid price is the anchor every margin calculation stands on. Quoting without one is guessing against the one party who knows the number.',
    source: 'Counted from the procurement history sheets of the NSN-Now export on disk, one row per recorded award. The line under this sentence names the exact files and the feed day this count was read from.',
    whatThisDoesNotDo:
      'History does not bind the next award. A price paid before is evidence, not a ceiling or a floor.',
  },
  {
    id: 'monopoly.distressed_tier_a',
    owner: 'T4 INTELLIGENCE',
    title: 'Tier A distressed suppliers',
    what: 'The hottest researched band of companies that stopped winning DLA awards: likely dead inventory, with verified ways to reach them.',
    how: 'Open Suppliers and work the Tier A tab first. Each row carries the researcher\'s rationale and contacts; mark a company contacted as you go.',
    why: 'A quiet company sitting on stock the government still buys is the cheapest way into a position. The tier ranks where an hour of calls is most likely to find it.',
    source: 'The researched supplier workbook on disk, tier and score carried through from the researcher unchanged. The line under this sentence names the exact file this count was read from.',
    whatThisDoesNotDo:
      'The tier is the researcher\'s judgment, not a measurement of inventory. Silence is a signal, not proof a company is gone, and nothing here confirms what a company still holds.',
  },
]
