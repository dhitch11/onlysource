/**
 * T3 ENGINE's ENTRIES FOR THE HELP REGISTRY. The lane that owns the score owns the sentence.
 *
 * Kept in a file this lane owns and imported by `components/help/registry.ts`, per the house
 * pattern (one import, one register call, no shared-file merge conflicts).
 *
 * WHY THIS FILE EXISTS NOW: the 2026-08-17 explainer census found the product's flagship
 * 0 to 100 score displayed on four surfaces (the Monopoly grid, the corner dossier's score
 * box, the dashboard's strongest-position card, the Intelligence distribution chart) with no
 * explanation anywhere, which failed Quality Bar G2 on the one number operators rank real
 * dollars by. These entries close that gap. Registry writing rule 5 holds: no figure is
 * typed into any sentence; the numbers live on the surfaces, computed.
 */

import type { HelpRecord } from '@/components/help/registry'

export const T3_ENTRIES: HelpRecord[] = [
  {
    id: 'score.corner_v0',
    owner: 'T3 ENGINE',
    title: 'CornerScore',
    what: 'A 0 to 100 rank of how strong this corner looks from the evidence we could actually read. Higher is stronger.',
    how: 'Use it to order the day\'s work, top down. Before money moves, open the row and read the five legs; a leg marked unread caps what the score can claim, and the gaps name what to go check.',
    why: 'The score decides where the first hour goes. Treating a capped score as a full read is how capital lands on a position nobody finished checking.',
    source: 'Computed deterministically from the five evidence legs on this row: live demand, competition, the price anchor, forward demand and feasibility. Each leg names its own records and feed day, and no language model touches it.',
    whatThisDoesNotDo:
      'It does not confirm a corner, and it is not odds of winning or a dollar figure. It cannot see market availability while no locator credential is connected, and a high score is a reason to check, never a reason to buy.',
    explainsAScore: true,
  },
  {
    id: 'score.disposition_mix',
    owner: 'T3 ENGINE',
    title: 'Disposition',
    what: 'The action state a row earned from its evidence: watchlist, insufficient data, flag, or skip. A verdict about evidence, not about value.',
    how: 'Read it beside the score. Work watchlist rows with a plan to close their named gaps, and treat insufficient data as homework, never as a weak yes.',
    why: 'At launch every corner reads watchlist or insufficient data by design, because feasibility is unread. Acting as if watchlist meant confirmed is betting on a leg nobody checked.',
    source: 'Assigned by the evidence-state decision table from the same legs the score uses. A load-bearing leg that abstains forces insufficient data; nothing here is set by hand.',
    whatThisDoesNotDo:
      'It does not rank rows against each other; the score does that. And it cannot promote a corner to confirmed while the feasibility leg has nothing to read.',
  },
  {
    id: 'board.evaluated_price',
    owner: 'T3 ENGINE',
    title: 'Evaluated price',
    what: 'What a quote would compare at in the automated evaluation. It abstains until award history and availability are read for the row.',
    how: 'Use the named gap as the to-do list: the column fills only from a real price anchor and a real availability read. Open the corner dossier to see which leg is missing for this stock number.',
    why: 'Quoting without an evaluated-price read is guessing against the one party who knows the number. The abstention is what keeps a guess from wearing a price.',
    source: 'Would be computed from the recorded award prices joined to this row, plus the flat surplus evaluation adder where it applies. Until both inputs exist for the row, the honest value is none, and none is what renders.',
    whatThisDoesNotDo:
      'An abstention is not a zero and not a verdict on the deal. It says the inputs are unread, and it never fills the cell with an estimate to look finished.',
  },
]
