/**
 * PREFILL: CARRYING MEASURED WORK FORWARD INTO THE PAPERWORK, AND SAYING WHERE EVERY VALUE CAME FROM.
 *
 * The defect this closes. Everything an operator decided in Find, Decide and Pursue was retyped by
 * hand into a GET form before a single document could be built: the stock number, the CAGE, the
 * quantity, the solicitation, the price. On a Monday with a solicitation closing at 3pm Eastern that
 * retyping is where a digit gets dropped, and a wrong digit in a federal deliverable is a false
 * representation with a signature under it.
 *
 * =====================================================================================================
 * THE RULE THIS MODULE IS BUILT AROUND: A PREFILLED FIELD IS A CLAIM.
 * =====================================================================================================
 * A value sitting in an input box looks exactly like a value a person typed and checked. So every
 * carried value here arrives with four things attached, and the screen renders all four:
 *
 *   1. WHAT IT IS. Not "quantity" but "the quantity DLA is buying on this solicitation", because the
 *      form field it lands in is used for three different quantities downstream and the operator has
 *      to know which one is sitting there.
 *   2. WHERE IT CAME FROM, by name: the feed day, the solicitation, the award and its date.
 *   3. ITS PROVENANCE STATE, measured or modeled, never blurred. A modeled figure is never carried
 *      into a field on this form at all; it is reported as a note and left out.
 *   4. WHETHER A PERSON STILL HAS TO CONFIRM IT before it may leave the building.
 *
 * =====================================================================================================
 * ABSTENTION IS A RESULT, NOT A GAP.
 * =====================================================================================================
 * Two approved CAGE codes on one stock number means we do not know which one this lot came from, so
 * nothing is carried and the reason is stated. The same for a part number that the cross-reference
 * records more than one of. An empty field with a sentence under it beats a plausible field every
 * time, and this module never fills a slot to make the form look complete.
 *
 * =====================================================================================================
 * NO IO, NO CLOCK. The caller assembles the evidence (see app/(app)/documents/prefill-source.ts) and
 * passes the instant in. That is what makes every sentence below testable without a data directory.
 * =====================================================================================================
 */

import type { DeliverableKind } from './artifacts'
import type { CapturedFacts } from './view-model'

/** The fields this module is allowed to carry a value into. Nothing else is ever prefilled. */
export type PrefillableField =
  | 'nsn'
  | 'cage'
  | 'part_number'
  | 'qty'
  | 'unit_price'
  | 'solicitation_number'
  | 'type_character'
  | 'is_automated'

export const PREFILLABLE_FIELDS: readonly PrefillableField[] = [
  'nsn', 'cage', 'part_number', 'qty', 'unit_price', 'solicitation_number', 'type_character',
  'is_automated',
]

/**
 * The provenance axis, spelled as lib/compliance/confirmation.ts spells it, because a second
 * vocabulary for the same three states is a second product.
 *
 * `modeled` never appears on a carried field. It is declared because the notes below report modeled
 * figures explicitly as the reason they were NOT carried, and the type is what stops a later edit
 * from quietly promoting one into a field.
 */
export type CarriedProvenance = 'measured' | 'modeled'

export type CarriedField = {
  readonly field: PrefillableField
  /** Exactly the string that goes into the input. A checkbox carries 'on'. */
  readonly value: string
  readonly provenance: CarriedProvenance
  /** The short name of the thing, for a dense list. */
  readonly what: string
  /** The full sentence rendered under the field. States what it is and what it is not. */
  readonly origin: string
  /**
   * True when this figure must not travel into a submitted deliverable until a person has said it is
   * theirs. Set on a carried PRICE, always: the last price the government paid is not our quote.
   */
  readonly needs_confirmation: boolean
}

export type PrefillAbstention = {
  readonly field: PrefillableField | 'supplier' | 'material_condition' | 'acquisition_channel'
  readonly reason: string
}

/**
 * Everything the pure builder is allowed to see. The server resolves this from the deal store and the
 * intelligence datasets; nothing below reads a file, a clock or an environment variable.
 */
export type PrefillEvidence = {
  /** Which door the operator came through. */
  readonly kind: 'deal' | 'corner'
  /** The deal id or the stock number that was asked for, exactly as it arrived. */
  readonly requested: string
  /** The feed day the workspace was serving when this evidence was read. Null when unreadable. */
  readonly feed_day: string | null
  readonly deal: {
    readonly id: string
    readonly title: string
    readonly ref: string
    readonly niin: string | null
    readonly stage: string
    /** Whole dollars, MODELED. Never carried into a field. */
    readonly modeled_value_usd: number | null
  } | null
  readonly corner: {
    readonly nsn: string
    readonly nomenclature: string
    readonly quantity: number | null
    readonly unit_of_issue: string
    readonly solicitation: string
    readonly approved_sources: readonly string[]
    readonly sole_source: boolean
  } | null
  readonly latest_award: {
    readonly unit_price: number | null
    /**
     * Why `unit_price` is null even though an award exists, or null when it is not withheld.
     *
     * SEPARATE FROM `unit_price: null` because the two states are different and the abstention
     * the operator reads has to say which one it is: "we have no award price" sends them looking
     * for data, "we have one and measured a problem in it" tells them to look at the award.
     */
    readonly price_withheld_reason?: string | null
    readonly award_date_iso: string | null
    readonly company: string | null
    readonly cage: string | null
  } | null
  /** Distinct part numbers the manufacturer cross-reference records for this stock number. */
  readonly part_numbers: readonly string[]
}

export type Prefill = {
  /** One line naming the door, rendered above the carried list. */
  readonly source_label: string
  readonly carried: readonly CarriedField[]
  readonly abstentions: readonly PrefillAbstention[]
  /** Facts worth stating that are not fields, above all the modeled deal value. */
  readonly notes: readonly string[]
}

export const NO_PREFILL: Prefill = { source_label: '', carried: [], abstentions: [], notes: [] }

/** A stock number is thirteen digits. Anything else is not one, and is not treated as one. */
export function looksLikeNsn(s: string): boolean {
  return /^\d{13}$/.test(s.replace(/[^0-9]/g, '')) && /^[\d-]+$/.test(s.trim())
}

/**
 * The ninth character of a DIBBS solicitation number, uppercased, with dashes and spaces removed.
 *
 * T and U in that position are the government's own automated-solicitation markers, so reading it is
 * reading a published identifier rather than inferring anything. Any other character, or a
 * solicitation too short to have a ninth position, returns null and nothing is carried.
 */
export function ninthCharacter(solicitation: string): 'T' | 'U' | null {
  const normalized = solicitation.replace(/[-\s]/g, '').toUpperCase()
  if (normalized.length < 9) return null
  const ninth = normalized.charAt(8)
  return ninth === 'T' || ninth === 'U' ? ninth : null
}

/** Money as the form expects to receive it: a plain decimal, no symbol, no separators. */
function priceString(n: number): string {
  return n.toFixed(2)
}

function feedPhrase(feedDay: string | null): string {
  return feedDay === null
    ? 'read from the government feed this workspace is serving (the feed day could not be read, so it is not named here)'
    : `read from the government feed day ${feedDay}`
}

/**
 * Build the prefill. Pure.
 *
 * ORDER OF PREFERENCE FOR THE STOCK NUMBER is deliberate: the corner row wins over the deal's own
 * reference, because the corner row is the parsed government record and the deal reference is a
 * string a person typed into a CRM card.
 */
export function buildPrefill(e: PrefillEvidence): Prefill {
  const carried: CarriedField[] = []
  const abstentions: PrefillAbstention[] = []
  const notes: string[] = []

  const sourceLabel =
    e.kind === 'deal'
      ? e.deal === null
        ? `Pipeline deal ${e.requested}`
        : `Pipeline deal "${e.deal.title}", stage ${e.deal.stage.replace(/_/g, ' ')}`
      : `Corner dossier ${e.requested}`

  const corner = e.corner

  // ------------------------------------------------------------------ the stock number
  if (corner !== null) {
    carried.push({
      field: 'nsn',
      value: corner.nsn,
      provenance: 'measured',
      what: 'National stock number',
      origin:
        `${corner.nsn} (${corner.nomenclature}), ${feedPhrase(e.feed_day)}. This is the stock number ` +
        'the rest of this form is about.',
      needs_confirmation: false,
    })
  } else if (e.deal !== null && looksLikeNsn(e.deal.ref)) {
    carried.push({
      field: 'nsn',
      value: e.deal.ref.trim(),
      provenance: 'measured',
      what: 'National stock number',
      origin:
        `Carried from the reference on the pipeline card, which is a person's own entry rather than a ` +
        'parsed government record. This stock number is not in the feed day this workspace is serving, ' +
        'so nothing else could be carried with it. Check it before you build a document on it.',
      needs_confirmation: true,
    })
  } else if (e.deal !== null) {
    abstentions.push({
      field: 'nsn',
      reason:
        `The pipeline card's reference is "${e.deal.ref}", which is not a thirteen-digit stock number, ` +
        'so nothing was carried into the stock-number field.',
    })
  }

  // ------------------------------------------------------------------ the solicitation
  if (corner !== null && corner.solicitation.trim() !== '') {
    carried.push({
      field: 'solicitation_number',
      value: corner.solicitation.trim(),
      provenance: 'measured',
      what: 'Solicitation number',
      origin:
        `The open solicitation carrying this requirement, ${feedPhrase(e.feed_day)}. The zero-rejection ` +
        'pre-flight runs against it.',
      needs_confirmation: false,
    })

    const ninth = ninthCharacter(corner.solicitation)
    if (ninth !== null) {
      carried.push({
        field: 'type_character',
        value: ninth,
        provenance: 'measured',
        what: 'Type character',
        origin:
          `Position nine of solicitation ${corner.solicitation.trim()} is ${ninth}, read straight off the ` +
          'published solicitation number. On a U-type buy surplus material is disqualified, so this ' +
          'character decides whether a whole path is open to you.',
        needs_confirmation: false,
      })
      carried.push({
        field: 'is_automated',
        value: 'on',
        provenance: 'measured',
        what: 'Automated solicitation',
        origin:
          `Position nine is ${ninth}, which is how DLA marks an automated solicitation. An automated buy ` +
          'can award without a human reading your quote, which is what the nine exception checks below ' +
          'are for.',
        needs_confirmation: false,
      })
    } else {
      abstentions.push({
        field: 'type_character',
        reason:
          `Position nine of solicitation ${corner.solicitation.trim()} is neither T nor U, so this build ` +
          'cannot say what type of buy it is and leaves the field undelivered. The pre-flight will ' +
          'report cannot assess rather than clear, which is the honest reading.',
      })
    }
  }

  // ------------------------------------------------------------------ the approved source CAGE
  if (corner !== null) {
    const sources = corner.approved_sources.map((c) => c.trim()).filter((c) => c !== '')
    if (sources.length === 1) {
      const only = sources[0] as string
      carried.push({
        field: 'cage',
        value: only,
        provenance: 'measured',
        what: 'Approved source CAGE code',
        origin:
          `${only} is the only company approved to make this item on the feed day this workspace is ` +
          `serving, ${feedPhrase(e.feed_day)}. That is what makes this a corner.`,
        needs_confirmation: false,
      })
    } else if (sources.length > 1) {
      abstentions.push({
        field: 'cage',
        reason:
          `${sources.length} companies are approved to make this item (${sources.join(', ')}), so this ` +
          'build cannot know which one your material came from. Enter the CAGE on the label.',
      })
    } else {
      abstentions.push({
        field: 'cage',
        reason:
          'The feed day this workspace is serving names no approved source for this stock number, so ' +
          'nothing was carried into the CAGE field.',
      })
    }
  }

  // ------------------------------------------------------------------ the part number
  const parts = [...new Set(e.part_numbers.map((p) => p.trim()).filter((p) => p !== ''))]
  if (parts.length === 1) {
    const only = parts[0] as string
    carried.push({
      field: 'part_number',
      value: only,
      provenance: 'measured',
      what: 'Part number',
      origin:
        `The manufacturer cross-reference records exactly one part number for this stock number, ${only}. ` +
        'Check it against the part in your hand before it goes on a traceability packet.',
      needs_confirmation: false,
    })
  } else if (parts.length > 1) {
    abstentions.push({
      field: 'part_number',
      reason:
        `The manufacturer cross-reference records ${parts.length} part numbers for this stock number ` +
        `(${parts.join(', ')}), so this build cannot choose one for you.`,
    })
  }

  // ------------------------------------------------------------------ the quantity
  if (corner !== null && corner.quantity !== null) {
    const ui = corner.unit_of_issue.trim()
    carried.push({
      field: 'qty',
      value: String(corner.quantity),
      provenance: 'measured',
      what: 'Quantity',
      origin:
        `Solicitation ${corner.solicitation.trim()} asks for ${corner.quantity.toLocaleString()}` +
        `${ui === '' ? '' : ` ${ui}`}, ${feedPhrase(e.feed_day)}. THIS IS WHAT DLA IS BUYING, not a ` +
        'count of what you hold. If you are quoting a different quantity, or your evidence covers a ' +
        'different quantity, change it.',
      needs_confirmation: false,
    })
  } else if (corner !== null) {
    abstentions.push({
      field: 'qty',
      reason:
        'The feed day this workspace is serving carries no parsed quantity for this requirement, so the ' +
        'quantity field was left empty rather than guessed.',
    })
  }

  // ------------------------------------------------------------------ the price
  const award = e.latest_award
  if (award !== null && award.unit_price !== null && award.unit_price > 0) {
    const who = award.company === null || award.company.trim() === '' ? null : award.company.trim()
    const when = award.award_date_iso === null ? null : award.award_date_iso.slice(0, 10)
    carried.push({
      field: 'unit_price',
      value: priceString(award.unit_price),
      provenance: 'measured',
      what: 'Unit price',
      origin:
        `${priceString(award.unit_price)} per unit is the LAST PRICE THE GOVERNMENT PAID for this stock ` +
        `number${when === null ? '' : `, awarded ${when}`}${who === null ? '' : ` to ${who}`}, measured ` +
        'from the award export. IT IS NOT YOUR QUOTE. It is here as an anchor. Change it to your figure, ' +
        'or confirm below that you are quoting this number, before any deliverable citing it is ready ' +
        'to submit.',
      needs_confirmation: true,
    })
  } else if (corner !== null) {
    abstentions.push({
      field: 'unit_price',
      reason:
        award?.price_withheld_reason
          ? `The price field was left empty and no anchor was carried. ${award.price_withheld_reason}`
          : 'No award with a usable unit price is on record for this stock number, so the price field was ' +
            'left empty. There is no anchor to carry and none was invented.',
    })
  }

  // ------------------------------------------------------------------ what is never carried
  abstentions.push({
    field: 'supplier',
    reason:
      'A supplier is who YOU are buying from. This product has not measured that, so the purchase ' +
      'order waits for you to name them.',
  })
  abstentions.push({
    field: 'material_condition',
    reason:
      'The condition of the material in your hand is a physical observation. Nothing in the feed can ' +
      'make it, so it is never carried and the classifier reports it as an unread fact until you enter it.',
  })
  abstentions.push({
    field: 'acquisition_channel',
    reason:
      'How you acquired the lot decides which provenance rung is even reachable. It is your record, ' +
      'not the feed, so it is never carried.',
  })

  // ------------------------------------------------------------------ notes
  if (e.deal !== null && e.deal.modeled_value_usd !== null) {
    notes.push(
      `This pipeline card carries a MODELED value of $${e.deal.modeled_value_usd.toLocaleString()}, ` +
        'computed as the requirement quantity times the last measured award unit price. It is a model, ' +
        'so it is reported here and carried into no field on this form.',
    )
  }
  if (e.kind === 'deal' && e.deal !== null && corner === null) {
    notes.push(
      'This deal has no corner row on the feed day this workspace is serving, so the solicitation, the ' +
        'approved source, the quantity and the price could not be carried. Only what the card itself ' +
        'holds was used.',
    )
  }
  if (corner !== null && !corner.sole_source) {
    notes.push(
      `${corner.approved_sources.length} companies are approved to make this item, so it is not a ` +
        'sole-source position and the surplus path is not the only way in.',
    )
  }

  return { source_label: sourceLabel, carried, abstentions, notes }
}

/** Apply carried values onto a facts object. Only the fields this module owns are ever touched. */
export function applyPrefill(base: CapturedFacts, prefill: Prefill): CapturedFacts {
  let out: CapturedFacts = base
  for (const c of prefill.carried) {
    if (c.field === 'is_automated') {
      out = { ...out, is_automated: c.value === 'on' }
    } else {
      out = { ...out, [c.field]: c.value }
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------
// RECONCILIATION ACROSS THE ROUND TRIP
// ---------------------------------------------------------------------------------------------------

/**
 * WHY THIS EXISTS. The generator submits by GET, so the instant an operator presses Run the pipeline
 * every carried value comes back as a query parameter that looks exactly like a typed one. Without
 * this function the screen would go on labelling an edited field "carried from the award export",
 * which is the same class of lie as an unlabelled prefill and arguably worse, because the label makes
 * it credible.
 *
 * So the carried set is rebuilt from the evidence on every render and compared, field by field,
 * against what actually came back:
 *
 *   unchanged  the value on screen is still the carried one
 *   edited     a person changed it, and it is now theirs
 *   cleared    a person emptied it, and nothing stands in for it
 */
export type CarriedStatus = 'unchanged' | 'edited' | 'cleared'

export type ReconciledCarry = {
  readonly field: PrefillableField
  readonly what: string
  readonly provenance: CarriedProvenance
  readonly origin: string
  readonly carried_value: string
  readonly current_value: string
  readonly status: CarriedStatus
  readonly needs_confirmation: boolean
  /** The one sentence the screen and the downloaded file both render for this field. */
  readonly statement: string
}

function currentValueOf(facts: CapturedFacts, field: PrefillableField): string {
  if (field === 'is_automated') return facts.is_automated ? 'on' : ''
  return facts[field]
}

export function reconcileCarried(
  prefill: Prefill,
  facts: CapturedFacts,
): readonly ReconciledCarry[] {
  return prefill.carried.map((c) => {
    const current = currentValueOf(facts, c.field).trim()
    const status: CarriedStatus =
      current === c.value ? 'unchanged' : current === '' ? 'cleared' : 'edited'
    const statement =
      status === 'unchanged'
        ? `${c.what}: ${c.value}, carried in and not changed. ${c.origin}`
        : status === 'edited'
          ? `${c.what}: ${current}, entered by the operator. The carried value was ${c.value}, and it ` +
            'was replaced, so the sentence that came with it no longer describes what is on the form.'
          : `${c.what}: empty. ${c.value} was carried in and the operator cleared it, so this field ` +
            'now states nothing.'
    return {
      field: c.field,
      what: c.what,
      provenance: c.provenance,
      origin: c.origin,
      carried_value: c.value,
      current_value: current,
      status,
      needs_confirmation: c.needs_confirmation,
      statement,
    }
  })
}

/**
 * WHICH DELIVERABLE ACTUALLY USES EACH CARRIED FIELD.
 *
 * Derived by reading REQUIRED_REFS and the four templates in ./artifacts.ts, not by intuition. It
 * matters because the blocker below has to be PRECISE: blocking a traceability packet on an
 * unconfirmed unit price would be a false blocker, and a control that cries wolf gets switched off,
 * which is how a real blocker eventually gets switched off with it.
 *
 * `type_character` maps to nothing because it is not a payload on any artifact. It steers the
 * pre-flight, and the pre-flight raises its own findings in its own words.
 */
export const FIELD_USED_BY: Readonly<Record<PrefillableField, readonly DeliverableKind[]>> = {
  nsn: ['quote_packet', 'purchase_order', 'traceability_packet', 'counter_offer_memo', 'invoice'],
  cage: ['traceability_packet'],
  part_number: ['traceability_packet'],
  qty: ['quote_packet', 'purchase_order', 'traceability_packet', 'invoice'],
  // The invoice is here for the same reason the quote packet is: it cites a price we send, so
  // an unconfirmed carried figure must hold it at draft. It is the LAST document in the chain
  // and the only one that asks to be paid, so it is the worst place for the government's price
  // to arrive unchallenged.
  unit_price: ['quote_packet', 'purchase_order', 'invoice'],
  solicitation_number: ['quote_packet'],
  type_character: [],
  is_automated: [],
}

/**
 * The blockers a carried-but-unconfirmed figure puts on the deliverables that cite it. FAILS TOWARD
 * REFUSING.
 *
 * The case this exists for is concrete and is the worst thing this whole surface could do: an
 * operator opens a corner, the last award price lands in the quote packet's unit price field, the
 * pre-flight is clear, the chip says READY TO SUBMIT, and a quote goes out at the price the previous
 * incumbent won at, chosen by nobody. So while a figure marked `needs_confirmation` is still sitting
 * at exactly the value that was carried in, every deliverable that cites it is a DRAFT.
 *
 * Two ways out, both a person acting: change the figure, or tick the confirmation. Editing clears it
 * because an edited value is the operator's own. There is no third way and no default that clears it,
 * because a default that clears a confirmation gate is the gate not existing.
 */
export function unconfirmedCarryBlockers(
  reconciled: readonly ReconciledCarry[],
  confirmed: boolean,
): Readonly<Record<DeliverableKind, readonly string[]>> {
  const out: Record<DeliverableKind, string[]> = {
    quote_packet: [],
    purchase_order: [],
    traceability_packet: [],
    counter_offer_memo: [],
    invoice: [],
  }
  if (confirmed) return out
  for (const r of reconciled) {
    if (!r.needs_confirmation || r.status !== 'unchanged') continue
    const sentence =
      `${r.what} is still the value carried in from a measured record (${r.carried_value}) and no ` +
      'person has confirmed it as ours. Change it, or tick the confirmation on the form'
    for (const kind of FIELD_USED_BY[r.field]) out[kind].push(sentence)
  }
  return out
}

/** Every unconfirmed carry, once, for the banner that has to say it in one place. */
export function unconfirmedCarries(
  reconciled: readonly ReconciledCarry[],
  confirmed: boolean,
): readonly ReconciledCarry[] {
  if (confirmed) return []
  return reconciled.filter((r) => r.needs_confirmation && r.status === 'unchanged')
}
