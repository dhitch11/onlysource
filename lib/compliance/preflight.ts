/**
 * 4.7Z THE ZERO-REJECTION COMPLIANCE PRE-FLIGHT.
 *
 * 4.7 asks "is this document genuine." This asks the earlier and higher-stakes question: will this
 * QUOTE survive automated evaluation at all, or does one red field auto-reject it with no recourse.
 * Every auto-rejected quote is a cornered opportunity thrown away silently, and the business is quoting
 * far off recent history on parts nobody else can supply, so a rejection here is pure lost revenue on
 * exactly the deals that pay the most.
 *
 * THE THREE CHECKS, and the one an operator would get backwards:
 *   1. The Part I para 3(a)(2) auto-DQ exception list. Nine exceptions; a single one present throws out
 *      the automated award. The two tripped by habit are a stray Remark and "None" against a
 *      Higher-Level Quality requirement.
 *   2. The QPL/QML/QSLD/QSLM and export-control listing gates. A listing gap on US or on OUR SOURCE
 *      auto-disqualifies, and both are knowable before the bid.
 *   3. The surplus T-versus-U branch. On a U-type AIDC solicitation surplus is DISQUALIFYING, which is
 *      the opposite of the T-type position and is detectable from a single character.
 *
 * WHY THERE IS A THIRD VERDICT VALUE THE SPEC DID NOT NAME.
 * The release order specifies `clear | blocked`. This module returns `clear | blocked | cannot_assess`,
 * and the added value is deliberate rather than a liberty. With two values, a candidate whose quote-form
 * data has not loaded returns `clear`, which is a fail-open control: it reads as "the machine will
 * accept this" when the truth is "we did not look." Most of this estate's worst defects were fail-open
 * checks returning a cheerful pass. `cannot_assess` names the field it could not read and blocks
 * nothing, so an operator can proceed with eyes open, and it can never be mistaken for a clearance.
 */

import { RULES, quotationOf, type RuleCitation } from './citations'
import type { CompliancePath, L04SelfClassification, LotCategoryOutcome } from './vocabularies'

/**
 * The solicitation facts this pre-flight needs. T2 delivers them; this lane parses nothing.
 * Every field is optional-with-unknown rather than defaulted, because a defaulted procurement fact is
 * an invented one.
 */
export type SolicitationFacts = {
  readonly solicitation_number: string
  /**
   * The type character in the solicitation number. T is a one-time buy, U is an Automated Indefinite
   * Delivery Contract. 'unknown' when T2 has not delivered it, never guessed from the number's shape.
   */
  readonly type_character: 'T' | 'U' | 'unknown'
  /** Batch field 002. I marks an AIDC solicitation and corroborates the type character. */
  readonly solicitation_type_indicator: 'F' | 'I' | 'P' | 'unknown'
  readonly is_automated: boolean | 'unknown'
  /** Qualification and export-control requirements cited in the item description. */
  readonly requires_qpl_or_qml: boolean | 'unknown'
  readonly requires_qsld_or_qsl: boolean | 'unknown'
  readonly cites_export_control: boolean | 'unknown'
  readonly requires_higher_level_quality: boolean | 'unknown'
}

/** The quote as it currently stands on the form. Answers we control. */
export type QuoteForm = {
  readonly taking_exception_to_item_description: boolean | 'unknown'
  readonly exception_to_packaging: boolean | 'unknown'
  readonly exception_to_fob_terms: boolean | 'unknown'
  readonly exception_to_inspection: boolean | 'unknown'
  readonly exception_to_required_quantity: boolean | 'unknown'
  readonly quantity_variance_greater_than_specified: boolean | 'unknown'
  /** True when the quote answers "None" to a Higher Level Contract Quality Requirement. */
  readonly higher_level_quality_answered_none: boolean | 'unknown'
  readonly quotes_child_labor: boolean | 'unknown'
  /** Any remark at all. The rule names "Quoting Remarks" with no materiality threshold. */
  readonly remarks_present: boolean | 'unknown'
  readonly validity_period_days: number | 'unknown'
}

/** Our own and our source's listing status. */
export type ListingStatus = {
  readonly quoter_on_qsld_or_qsl: boolean | 'unknown'
  readonly quoted_manufacturer_on_qpl_or_qml: boolean | 'unknown'
  readonly quoter_export_certification_current: boolean | 'unknown'
  readonly manufacturer_export_certification_current: boolean | 'unknown'
}

export type PreflightCandidate = {
  readonly lot_id: string
  readonly compliance_path: CompliancePath
  readonly category: LotCategoryOutcome
  readonly l04_self_classification: L04SelfClassification | 'unknown'
  readonly solicitation: SolicitationFacts
  readonly quote: QuoteForm
  readonly listing: ListingStatus
}

export type PreflightVerdict = 'clear' | 'blocked' | 'cannot_assess'

export type PreflightFinding = {
  readonly check: 'auto_dq_exceptions' | 'listing_gates' | 'surplus_solicitation_type' | 'alternate_on_automated'
  readonly severity: 'blocking' | 'unassessable'
  /** The specific field on THIS candidate that failed. Never a general complaint. */
  readonly failing_field: string
  readonly statement: string
  /** The rule, quoted verbatim when provenance permits it, and named either way. */
  readonly rule: { readonly citation: RuleCitation; readonly quote: string | null }
  /** What to do instead. A dead end is not an answer. */
  readonly reroute: string | null
}

export type PreflightResult = {
  readonly lot_id: string
  readonly solicitation_number: string
  readonly verdict: PreflightVerdict
  readonly findings: readonly PreflightFinding[]
  /** One line when clean, so a clear pre-flight gets out of the way. */
  readonly clear_statement: string | null
}

function ruleWithQuote(citation: RuleCitation): { citation: RuleCitation; quote: string | null } {
  const q = quotationOf(citation)
  return { citation, quote: q.ok ? q.quote : null }
}

/** True only when the flag is definitely true. 'unknown' is not true, and neither is false. */
function definitely(v: boolean | 'unknown'): boolean {
  return v === true
}

export function runPreflight(c: PreflightCandidate): PreflightResult {
  const findings: PreflightFinding[] = []

  // ------------------------------------------------------------------ CHECK 1: the nine auto-DQ exceptions
  const exceptionRule = ruleWithQuote(RULES.ms_auto_dq_exceptions)
  const nine: readonly { field: keyof QuoteForm; roman: string; label: string }[] = [
    { field: 'taking_exception_to_item_description', roman: '(i)', label: 'taking exception to the item description' },
    { field: 'exception_to_packaging', roman: '(ii)', label: 'an exception to packaging requirements' },
    { field: 'exception_to_fob_terms', roman: '(iii)', label: 'an exception to FOB terms' },
    { field: 'exception_to_inspection', roman: '(iv)', label: 'an exception to inspection requirements' },
    { field: 'exception_to_required_quantity', roman: '(v)', label: 'an exception to the required quantity' },
    { field: 'quantity_variance_greater_than_specified', roman: '(vi)', label: 'a quantity variance greater than specified' },
    { field: 'higher_level_quality_answered_none', roman: '(vii)', label: 'an answer of None where a Higher Level Contract Quality Requirement is required' },
    { field: 'quotes_child_labor', roman: '(viii)', label: 'quoting the use of child labor' },
    { field: 'remarks_present', roman: '(ix)', label: 'a Remark on the quote' },
  ]

  for (const e of nine) {
    const v = c.quote[e.field]
    if (definitely(v as boolean | 'unknown')) {
      findings.push({
        check: 'auto_dq_exceptions',
        severity: 'blocking',
        failing_field: `quote.${e.field}`,
        statement:
          `The quote carries ${e.label}, which is exception ${e.roman} on the list that makes a ` +
          'quotation ineligible for an automated award. One exception present is enough to throw out ' +
          'the award, and there is no recourse after submission.',
        rule: exceptionRule,
        reroute:
          e.field === 'remarks_present'
            ? 'Remove the remark before submitting. If the point genuinely must be communicated, it ' +
              'belongs in correspondence with the buyer, not in the quote.'
            : e.field === 'higher_level_quality_answered_none'
              ? 'Answer the Higher Level Contract Quality Requirement properly, or accept that this ' +
                'line is not winnable on the automated path.'
              : 'Remove the exception, or route this to a manual evaluation channel rather than the ' +
                'automated one.',
      })
    }
  }

  // The 90-day validity floor, which sits with the Part II exceptions on an AIDC buy.
  if (c.solicitation.type_character === 'U' && typeof c.quote.validity_period_days === 'number') {
    if (c.quote.validity_period_days < 90) {
      findings.push({
        check: 'auto_dq_exceptions',
        severity: 'blocking',
        failing_field: 'quote.validity_period_days',
        statement:
          `The quote is valid for ${c.quote.validity_period_days} days. On an AIDC solicitation a ` +
          'validity period under the 90-day minimum makes the quotation ineligible for automated award.',
        rule: ruleWithQuote(RULES.ms_surplus_ineligible_on_aidc),
        reroute: 'Extend the validity period to at least 90 days before submitting.',
      })
    }
  }

  // ------------------------------------------------------------------ CHECK 2: listing gates
  const listingRule = ruleWithQuote(RULES.ms_listing_gates)

  if (definitely(c.solicitation.requires_qpl_or_qml)) {
    if (c.listing.quoted_manufacturer_on_qpl_or_qml === false) {
      findings.push({
        check: 'listing_gates',
        severity: 'blocking',
        failing_field: 'listing.quoted_manufacturer_on_qpl_or_qml',
        statement:
          'The item description cites a Qualified Product List or Qualified Manufacturers List, and the ' +
          'manufacturer being quoted is not on it. That is an automatic disqualification, and it was ' +
          'knowable before the bid.',
        rule: listingRule,
        reroute:
          'Quote a listed manufacturer, or do not bid this line. A listing gap cannot be cured after ' +
          'submission.',
      })
    } else if (c.listing.quoted_manufacturer_on_qpl_or_qml === 'unknown') {
      findings.push({
        check: 'listing_gates',
        severity: 'unassessable',
        failing_field: 'listing.quoted_manufacturer_on_qpl_or_qml',
        statement:
          'The item description cites a qualification list, and whether the quoted manufacturer is on ' +
          'it has not been checked. This is a hard gate, so it must be checked rather than assumed.',
        rule: listingRule,
        reroute: 'Confirm the manufacturer against the cited list before submitting.',
      })
    }
  }

  if (definitely(c.solicitation.requires_qsld_or_qsl) && c.listing.quoter_on_qsld_or_qsl === false) {
    findings.push({
      check: 'listing_gates',
      severity: 'blocking',
      failing_field: 'listing.quoter_on_qsld_or_qsl',
      statement:
        'The item requires the quoter to be on the Qualified Suppliers List of Distributors or the ' +
        'Qualified Suppliers List, and we are not on it. That disqualifies the quotation.',
      rule: listingRule,
      reroute: 'Do not bid this line until the listing is in place.',
    })
  }

  if (definitely(c.solicitation.cites_export_control)) {
    const stale: string[] = []
    if (c.listing.quoter_export_certification_current === false) stale.push('ours')
    if (c.listing.manufacturer_export_certification_current === false) stale.push("the manufacturer's")
    if (stale.length > 0) {
      findings.push({
        check: 'listing_gates',
        severity: 'blocking',
        failing_field: 'listing.export_certification_current',
        statement:
          `The item description cites export control, which requires current certifications for both ` +
          `the quoter and the manufacturer. ${stale.join(' and ')} certification is not current. A ` +
          'lapsed export-control certification is an automatic disqualifier and it is knowable in ' +
          'advance.',
        rule: listingRule,
        reroute:
          'Renew the certification, or quote a source whose certification is current. Watch the ' +
          'accreditation expiry feed so this is caught before a bid rather than during one.',
      })
    }
  }

  // ------------------------------------------------------------------ CHECK 3: the T versus U surplus fork
  const isSurplus = c.compliance_path === 'c04_surplus_representation' || c.category === 'government_surplus'

  if (isSurplus) {
    const aidc =
      c.solicitation.type_character === 'U' || c.solicitation.solicitation_type_indicator === 'I'
    const typeUnknown =
      c.solicitation.type_character === 'unknown' && c.solicitation.solicitation_type_indicator === 'unknown'

    if (aidc) {
      findings.push({
        check: 'surplus_solicitation_type',
        severity: 'blocking',
        failing_field: 'solicitation.type_character',
        statement:
          `Solicitation ${c.solicitation.solicitation_number} is an AIDC buy, and quoting unused former ` +
          'Government surplus property on an AIDC solicitation is ineligible for automated award. This ' +
          'is the opposite of the position on a one-time buy, and it is the fork most often guessed ' +
          'wrong. No price wins this line.',
        rule: ruleWithQuote(RULES.ms_surplus_ineligible_on_aidc),
        reroute:
          'Route this lot to a one-time buy for the same stock number, or to the L04(j) ' +
          'future-evaluation channel. Do not spend a sourcing hour on a quote the machine will not ' +
          'accept.',
      })
    } else if (typeUnknown) {
      findings.push({
        check: 'surplus_solicitation_type',
        severity: 'unassessable',
        failing_field: 'solicitation.type_character',
        statement:
          'This is a surplus candidate and the solicitation type has not been delivered, so the single ' +
          'most decisive gate on it cannot be evaluated. On an AIDC buy surplus is disqualified; on a ' +
          'one-time buy it is not.',
        rule: ruleWithQuote(RULES.ms_surplus_ineligible_on_aidc),
        reroute: 'Obtain the solicitation type character or type indicator before committing effort.',
      })
    }
  }

  // ------------------------------------------------------------------ CHECK 3b: alternate on an automated buy
  if (c.l04_self_classification === 'alternate_product' && definitely(c.solicitation.is_automated)) {
    findings.push({
      check: 'alternate_on_automated',
      severity: 'blocking',
      failing_field: 'l04_self_classification',
      statement:
        'This candidate is an alternate product and the solicitation is automated. An alternate offer ' +
        'cannot win an automated award at any price, so pricing it is wasted effort.',
      rule: ruleWithQuote(RULES.ms_alternate_no_automated_award),
      reroute:
        'Submit it to the L04(j) future-evaluation channel instead. Also check whether this part number ' +
        'was ever delivered under this stock number: if it was, the correct L04 box is ' +
        'previously-approved product rather than alternate, and the offer becomes evaluable.',
    })
  }

  const blocking = findings.filter((f) => f.severity === 'blocking')
  const unassessable = findings.filter((f) => f.severity === 'unassessable')

  const verdict: PreflightVerdict =
    blocking.length > 0 ? 'blocked' : unassessable.length > 0 ? 'cannot_assess' : 'clear'

  return {
    lot_id: c.lot_id,
    solicitation_number: c.solicitation.solicitation_number,
    verdict,
    findings,
    clear_statement:
      verdict === 'clear'
        ? 'Pre-flight clear. No automated-award exception, no listing gap, and the solicitation type ' +
          'does not exclude this material.'
        : null,
  }
}
