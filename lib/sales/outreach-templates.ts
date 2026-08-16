/**
 * THE APPROVED OUTREACH TEMPLATES — the operator's own proven copy, encoded.
 *
 * Hunter Mode's `startOutreach` takes an APPROVED TEMPLATE id and, until this file existed,
 * there was no approved template anywhere in the repo: the outreach engine had literally
 * nothing it was allowed to send. These two templates are the operator's field-proven
 * assets, carried into the product with their structure intact:
 *
 *   1. THE BUY-SIDE EMAIL ("That old DLA inventory is just collecting dust"). The pitch that
 *      matches why the distressed book exists: a firm that stopped winning DLA awards is
 *      sitting on inventory it made for the government, and the offer is to MARKET that
 *      inventory back into the supply chain or BUY it outright, before it goes to the
 *      scrapman. Not "fill my live requirements", which reads as spam to a shop whose CAGE
 *      is retired.
 *   2. THE FOLLOW-UP CALL SCRIPT, with its discovery questions, its objection branches, and
 *      the information-to-capture checklist. Even a No answers why, and that answer is
 *      recorded, not discarded.
 *
 * EVERY SLOT IS A DETERMINISTIC VALUE from the researched supplier file or the operator's
 * own identity. No model writes into these at send time; free prose reaches a supplier only
 * on a human-reviewed send. This module is client-safe on purpose (no node imports): the
 * /suppliers compose control builds its draft from the same functions the tests exercise.
 *
 * SINGLE-OPERATOR LAW: everything here DRAFTS. The operator sends. Nothing in this file
 * touches a transport.
 */

// ---------------------------------------------------------------------------------------
// TEMPLATE REGISTRY
// ---------------------------------------------------------------------------------------

export type OutreachTemplate = {
  /** Stable id `startOutreach` can carry. Never renamed once shipped. */
  id: string
  channel: 'email' | 'call'
  name: string
  /** The deterministic slots this template consumes. Nothing else may enter it. */
  slots: readonly string[]
  /** Where the copy came from. Provenance, not decoration. */
  provenance: string
}

export const BUY_SIDE_EMAIL_TEMPLATE_ID = 'buy_side_dormant_inventory_v1'
export const FOLLOW_UP_CALL_TEMPLATE_ID = 'follow_up_call_dla_inventory_v1'

export const OUTREACH_TEMPLATES: readonly OutreachTemplate[] = [
  {
    id: BUY_SIDE_EMAIL_TEMPLATE_ID,
    channel: 'email',
    name: 'Buy-side: dormant DLA inventory',
    slots: [
      'recipient_first_name',
      'company',
      'cage',
      'last_award_month_year',
      'holds_inventory',
      'nsn_fact_lines',
    ],
    provenance:
      "The operator's proven pitch ('That old DLA inventory is just collecting dust'), " +
      'rebuilt around the dual offer: market the inventory back into the government supply ' +
      'chain, or buy it outright.',
  },
  {
    id: FOLLOW_UP_CALL_TEMPLATE_ID,
    channel: 'call',
    name: 'Follow-up call: DLA inventory',
    slots: ['caller_name', 'contact_name', 'operator_name'],
    provenance:
      "The operator's follow-up call script, structure intact: opening, discovery " +
      'questions, objection branches, and the information-to-capture checklist.',
  },
]

/** Resolve an approved template by id, or null. `startOutreach` callers validate through this. */
export function resolveOutreachTemplate(id: string): OutreachTemplate | null {
  return OUTREACH_TEMPLATES.find((t) => t.id === id) ?? null
}

// ---------------------------------------------------------------------------------------
// RECIPIENT RESOLUTION — the greeting belongs to the person the address belongs to
// ---------------------------------------------------------------------------------------

type ContactLike = {
  name: string | null
  email: string | null
  verified: boolean
}

type SupplierLike = {
  email: string | null
  executive: string | null
  contacts: readonly ContactLike[]
}

export type ComposeRecipient = {
  email: string
  /** The name of the person this ADDRESS belongs to, or null. Never a name from another row. */
  name: string | null
}

/**
 * Pick the address to write to, and the name that genuinely belongs to it.
 *
 * The defect this replaces: the draft was addressed to the company inbox while greeting the
 * executive by first name, a visible mail-merge error to the one person we want a reply
 * from. The rule now: a name appears in the greeting ONLY when it is the name of the person
 * whose address is on the To line.
 *
 *   1. a VERIFIED contact with both a name and an email
 *   2. any contact with both a name and an email
 *   3. the company-level email; its name only if a listed contact carries that exact address
 *   4. any contact with an email at all (name when they have one)
 */
export function bestRecipient(r: SupplierLike): ComposeRecipient | null {
  const named = r.contacts.filter((c) => c.email && c.name)
  const verified = named.find((c) => c.verified)
  if (verified) return { email: verified.email as string, name: verified.name }
  if (named[0]) return { email: named[0].email as string, name: named[0].name }
  if (r.email) {
    const owner = r.contacts.find(
      (c) => c.email && c.email.trim().toLowerCase() === (r.email as string).trim().toLowerCase(),
    )
    return { email: r.email, name: owner?.name ?? null }
  }
  const any = r.contacts.find((c) => c.email)
  if (any) return { email: any.email as string, name: any.name }
  return null
}

/** First word of a full name, for the greeting. */
export function firstNameOf(name: string | null): string | null {
  if (!name) return null
  const first = name.trim().split(/\s+/)[0]
  return first && first.length > 0 ? first : null
}

// ---------------------------------------------------------------------------------------
// THE BUY-SIDE EMAIL DRAFT — deterministic, grounded in the row's own measured fields
// ---------------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/**
 * "2021-11-09" -> "Nov 2021". Deterministic table, no locale API, so the same input renders
 * the same string on server and client alike. Unparseable input returns null and the clause
 * that would have carried it is omitted, never guessed.
 */
export function monthYearOf(iso: string | null): string | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})/.exec(iso.trim())
  if (!m) return null
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${month} ${m[1]}` : null
}

/** One measured NSN fact about THIS supplier's CAGE, rendered as one sentence. */
export type SupplierNsnFact = {
  /** 13 contiguous digits, exactly as the government file carries it. */
  nsn: string
  /** How the award index ties this CAGE to the NSN. */
  kind: 'awarded' | 'lists_stock'
  /** True when the NSN is on the corner map, meaning an open government requirement today. */
  liveRequirement: boolean
}

export function nsnFactLine(f: SupplierNsnFact): string {
  const tie = f.kind === 'awarded' ? 'is on the recorded DLA award history for' : 'lists stock for'
  return f.liveRequirement
    ? `Your CAGE ${tie} NSN ${f.nsn}, and the government has an open requirement for it right now.`
    : `Your CAGE ${tie} NSN ${f.nsn}.`
}

export type BuySideDraftInput = {
  /** The first name of the person the To address belongs to, or null. */
  recipientFirstName: string | null
  company: string | null
  cage: string
  /** ISO date of the last recorded award, from the researched file. */
  lastAwardedAt: string | null
  /** The researched "does this CAGE hold inventory" read, verbatim from the file. */
  holdsInventory: string | null
  /** Measured CAGE-to-NSN facts, at most a couple. Empty means the line is omitted, never padded. */
  nsnFacts: readonly SupplierNsnFact[]
}

/**
 * The draft the operator edits and sends. Every line is conditional on the field that feeds
 * it being measured, per the evidence-state contract, and the operator signs it themselves:
 * no name and no company is compiled into the sign-off.
 */
export function buySideEmailDraft(input: BuySideDraftInput): { subject: string; body: string } {
  const subject = 'That old DLA inventory is just collecting dust'

  const first = input.recipientFirstName?.trim()
  const greeting = first ? `Hi ${first},` : 'Hi,'

  const monthYear = monthYearOf(input.lastAwardedAt)
  const who = input.company?.trim() || 'Your company'
  const anchor = monthYear
    ? `${who} made parts for DLA (CAGE ${input.cage}; last recorded award ${monthYear}).`
    : `${who} made parts for DLA (CAGE ${input.cage}).`

  const isManufacturer = /manufact/i.test(input.holdsInventory ?? '')
  const offer = isManufacturer
    ? 'I work with manufacturers to market the components you have made for DLA back into the government supply chain, or to buy your entire inventory outright.'
    : 'I buy dormant DLA inventory outright, or market it back into the government supply chain for you.'

  const facts = input.nsnFacts.slice(0, 2).map(nsnFactLine)

  const lines = [
    greeting,
    '',
    `${anchor} If any of that inventory is still on the shelf, it is worth real money rather than the scrapman.`,
    '',
    offer,
    ...(facts.length > 0 ? ['', ...facts] : []),
    '',
    'It is an easy process. Do you still have stock from those contracts? A quick reply gets it moving.',
    '',
    'Thanks,',
    '',
  ]
  return { subject, body: lines.join('\n') }
}

// ---------------------------------------------------------------------------------------
// THE FOLLOW-UP CALL SCRIPT — structure intact, rendered next to the phone number
// ---------------------------------------------------------------------------------------

export type CallScriptSection = { label: string; lines: readonly string[] }

/**
 * The operator's call script as renderable sections. {Name} marks where the caller says the
 * contact's name; it is a visible cue for the person on the phone, not a merge field.
 */
export const FOLLOW_UP_CALL_SCRIPT: readonly CallScriptSection[] = [
  {
    label: 'Opening',
    lines: [
      'Hi, this is (your name) calling. May I speak with (Name)?',
      'Thanks for taking my call. I am following up on an email we sent about a possible partnership concerning excess or inactive DLA inventory. Did you have a chance to see it?',
    ],
  },
  {
    label: 'The concept, in one breath',
    lines: [
      'I was not calling to sell you anything today. Many companies have inventory from previous DLA or defense contracts that may no longer be generating value. We look to either purchase that inventory or work with manufacturers to bring it back into the marketplace.',
      'Pause. Let them talk.',
    ],
  },
  {
    label: 'Discovery questions',
    lines: [
      'Do you still have inventory from past defense contracts?',
      'Is that something you have ever considered monetizing?',
      'Have you worked with anyone before to help sell or purchase that inventory?',
    ],
  },
  {
    label: 'If they express interest',
    lines: [
      'Rather than explain everything over the phone, we would like to schedule a short call to walk through what we are looking to accomplish. Would sometime next week work?',
    ],
  },
  {
    label: 'If they no longer have inventory',
    lines: [
      'Thanks for letting me know. Out of curiosity, are you still doing any defense work today?',
      'Would you ever consider getting back into defense work if the administrative burden were reduced? (This gives you valuable market intelligence.)',
    ],
  },
  {
    label: 'If they say not interested',
    lines: [
      'I appreciate your time. Before I let you go, may I ask one quick question? Was it simply that you do not have inventory anymore, or is there another reason the opportunity is not a fit?',
      'This information is incredibly valuable. Even a No answers why.',
    ],
  },
]

/**
 * The information-to-capture checklist, verbatim in spirit from the script. These six facts
 * are what a completed call must come home with; a call that collapses to one "contacted"
 * bit discards the market intelligence the script exists to gather.
 */
export const CALL_CAPTURE_FIELDS = [
  { id: 'decision_maker', label: 'Decision maker' },
  { id: 'email_confirmed', label: 'Email confirmed' },
  { id: 'has_excess_inventory', label: 'Has excess inventory' },
  { id: 'interested_in_selling', label: 'Interested in selling' },
  { id: 'interested_in_consignment', label: 'Interested in consignment' },
  { id: 'wants_meeting', label: 'Wants meeting' },
] as const

export type CallCaptureFieldId = (typeof CALL_CAPTURE_FIELDS)[number]['id']
