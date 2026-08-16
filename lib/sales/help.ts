/**
 * Help entries for the pursuit wire and the pipeline surfaces. The lane that owns the deal
 * store owns these sentences (registry rule: the lane that owns the number writes the
 * words). Registered from components/help/registry.ts with one import and one call.
 *
 * Registry writing rule 5 holds: no figure is typed into any sentence here. The modeled
 * buy value's arithmetic is described; its number lives on the surface, computed.
 */

import type { HelpRecord } from '@/components/help/registry'

export const PURSUIT_ENTRIES: HelpRecord[] = [
  {
    id: 'pursuit.pursue_action',
    owner: 'T6 AUTOMATION',
    title: 'Pursue',
    what: 'One press starts a real deal for this part in your pipeline, carrying its stock number and its measured facts.',
    how: 'Press Pursue on a row worth an hour of work. The part lands in Opportunities with its first next step already written. Open Pipeline to work it.',
    why: 'A find that never becomes a deal earns nothing. This is the wire between seeing an opportunity and working it, and it is where the money starts moving.',
    source: 'The deal is written to your own stored pipeline. Its value, when shown, is the quantity times the last award unit price from the government files on this row.',
    whatThisDoesNotDo:
      'It does not contact anyone, quote anything, or commit a dollar. It also does not duplicate: pursuing the same stock number twice lands on the one existing deal.',
  },
  {
    id: 'pursuit.modeled_buy_value',
    owner: 'T6 AUTOMATION',
    title: 'Modeled buy value',
    what: 'The quantity the government asked for, times the last unit price it actually paid. A model of the size of the buy, not a quote.',
    how: 'Use it to rank which pursuits are worth the hour. Check the award history on the dossier before you trust it with real money.',
    why: 'Ranking pursuits by size is how a two-person shop spends its day on the biggest lanes. Treating this model as a promised price is how a quote loses money.',
    source: 'Both legs are read from the government files: the quantity from the solicitation line, the unit price from the recorded award history. When either is unread the deal carries no value at all.',
    modelled: true,
  },
  {
    id: 'pursuit.stage_counts',
    owner: 'T6 AUTOMATION',
    title: 'Pipeline by stage',
    what: 'How many of your deals sit in each of the five stages, counted from your stored pipeline right now.',
    how: 'Read it left to right as the health of the funnel: plenty in Opportunities and nothing in Quoting means finds are not being worked. Press a stage to open the pipeline there.',
    why: 'The count that matters is the one that moves right. A fat left column and an empty right one is the difference between a research hobby and a business.',
    source: 'Counted from the deals you and Hunter Mode have stored, never estimated. An empty stage shows zero because it is truly empty.',
    whatThisDoesNotDo:
      'It does not include revenue that was never entered as a deal, and it does not forecast: it counts what is stored, today.',
  },
]
