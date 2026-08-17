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
    whatThisDoesNotDo:
      'It does not promise the next award\'s price or quantity. The government can buy fewer, pay less, or not buy at all, and a deal with either leg unread honestly carries no value rather than a guess.',
    // A dollar figure operators rank pursuits by IS a figure acted on financially, which is
    // exactly the scope the explainsAScore flag documents, so the fifth-field gate fires here.
    explainsAScore: true,
    modelled: true,
  },
  {
    id: 'pursuit.pursuit_package',
    owner: 'T6 AUTOMATION',
    title: 'Pursuit package',
    what: 'One press writes a deal memo for this part: the corner case, the modeled economics with their basis, who holds the article, the gaps.',
    how: 'Generate it from the dossier or a pipeline card, read it, download it, or email it to yourself. Use it to decide the pursuit and to brief a partner.',
    why: 'A pursuit without a memo is a hunch. The memo is what a partner or a lender reads before money moves, and a gap named early is a rejection avoided.',
    source: 'The engine assembles every fact from the government files and the researched supplier book; the analyst model writes only the sentences and is barred from adding a number. The output names the model that served it.',
    whatThisDoesNotDo:
      'It does not invent a figure to fill a gap, does not contact anyone, and does not submit anything to a government system. A sentence carrying an unmeasured number is withheld and counted.',
  },
  {
    id: 'pursuit.outreach_draft',
    owner: 'T6 AUTOMATION',
    title: 'Draft supplier outreach',
    what: 'Writes the buy-side email to a supplier who lists stock for this part: the dormant-inventory offer, grounded in the measured facts.',
    how: 'Press it on a deal whose stock number has listed holders. Read the draft, copy it, and send it from your own mail client. Email-me delivers it to your inbox only.',
    why: 'The reply rate lives on homework: a draft naming their own stock number and award history reads as a real offer, not spam. The dead stock is the opportunity.',
    source: 'Grounded in the outreach dossier: the availability sheet, the award history, and the researched supplier book, joined by CAGE. The output names the model that wrote it.',
    whatThisDoesNotDo:
      'It never sends to the supplier. The transport can address the operator alone, by allowlist, and it is disarmed by default. You send; the system drafts.',
  },
  {
    id: 'pursuit.recorded_close',
    owner: 'T6 AUTOMATION',
    title: 'Recorded close',
    what: 'What a deal ACTUALLY closed for, entered by you when it moves into Won and Revenue, with the award or PO reference behind it.',
    how: 'Move a deal into Won and the close form opens: the modeled value is offered as an editable default, and the award reference is required. Won and Revenue sums these recorded closes only.',
    why: 'A revenue column that sums its own estimates reports a wish. The recorded close is the number you can defend, and the reference is where an auditor goes to check it.',
    source: 'Typed by you at the moment of the win, stored on the deal, and cleared with a stated note if the deal ever leaves Won. Never copied from the model.',
    whatThisDoesNotDo:
      'It does not carry the modeled value forward as if it were real, and it cannot be edited in place: the only way to change it is to move the deal honestly.',
  },
  {
    id: 'pursuit.stage_guard',
    owner: 'T6 AUTOMATION',
    title: 'Stage evidence',
    what: 'Each stage asserts a fact a deal must carry: Leads a running pursuit, Quoting a saved packet, Won a recorded close with its reference.',
    how: 'Move a card and the board asks for the evidence the stage needs. A refusal names exactly what is missing and where to build it; every move lands in the audit trail first.',
    why: 'A pipeline that lets any card sit anywhere reports fiction. The guard is why the stage counts and the Won total are numbers you can act on.',
    source: 'Checked server-side on every stage change: your attestation for Leads, the Documents packet store for Quoting, and your close entry for Won, with an audit row written before the move.',
    whatThisDoesNotDo:
      'It does not block moving a deal backwards to tell the truth about a stalled pursuit, and it never moves a card by itself.',
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
