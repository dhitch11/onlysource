/**
 * THE RULE CITATION REGISTRY.
 *
 * Every compliance verdict this lane produces must show the rule that produced it, quoted, with its
 * identifier and effective date, and never paraphrased (T5 charter section 5, item 1). This module is
 * the only place the regulation text lives, and it exists to make three failures impossible rather
 * than merely discouraged.
 *
 * FAILURE 1: SHIPPING A PARAPHRASE AS A QUOTATION.
 * A quotation can only be obtained through `quotationOf()`, which returns a Result. There is no
 * exported field access that hands a caller a bare quotable string, so a paraphrase cannot acquire
 * quotation marks by accident.
 *
 * FAILURE 2: QUOTING TEXT NOBODY HAS READ IN THE PRIMARY SOURCE.
 * Procurement note C03 (DLAD 4.703) is the live example and the reason this guard exists. Earlier
 * drafts of the T5 handoff carried a long C03 sentence presented as verbatim; it was never captured
 * in any research digest, and this terminal propagated it once before checking. The conductor
 * quarantined it on 2026-08-13. It is registered here with `quote_status:
 * 'unverified_pending_primary_pull'` and `text: null`, so `quotationOf(RULES.c03_retention)` cannot
 * return a string at all. The ARGUMENT C03 supports (submitting a quote is itself the traceability
 * certification, so the chain must be captured at intake) is carried in `argument`, which is our own
 * words and is typed differently from a quotation precisely so the two can never be confused.
 *
 * FAILURE 3: RENDERING A STALE REVISION NUMBER TO A CUSTOMER.
 * The DLA Master Solicitation is cited as Rev-81 (the corpus PDF) per the conductor's 2026-08-13
 * ruling, with the governing Fast-Auto text stated unchanged through Rev-104. A revision number is
 * a moving fact: it advances without notice, and a customer-facing surface that prints one asserts
 * something we have not checked today. Those citations carry `bare_revision_customer_renderable:
 * false`, and `citationLabel()` refuses to produce a customer-audience label for them unless the
 * caller supplies evidence of a live current-revision check. Internal surfaces render freely.
 *
 * WHY A REGISTRY AND NOT INLINE STRINGS: the same clause is cited by the classifier, the pre-flight,
 * the readiness verdict, the obligation catalog and four deliverable templates. Inline strings drift,
 * and a regulation quoted five ways in one packet is the document-forensics defect this lane is
 * supposed to detect in other people's paperwork.
 */

/** Whether the exact wording has been read in the primary source, or is merely believed. */
export type QuoteStatus = 'verified_primary' | 'unverified_pending_primary_pull'

/**
 * A quotation that provenance permits us to print inside quotation marks. Nominal: the brand cannot
 * be written by a caller, so the only way to hold one is to have gone through `quotationOf()`.
 */
declare const VERIFIED_QUOTE: unique symbol
export type VerifiedQuote = string & { readonly [VERIFIED_QUOTE]: true }

export type RuleCitation = {
  /** Stable key used by verdicts, obligations and templates. */
  readonly id: string
  /** The issuing body, spelled as a person would read it aloud. */
  readonly authority: string
  /** The pin a contracting officer would look up. */
  readonly identifier: string
  /** The rule's own title, used to resolve note semantics when a letter drifts. */
  readonly title: string
  /**
   * Effective date as printed on the instrument, or null when the instrument carries none.
   * Never inferred: an absent date reads as absent, not as today.
   */
  readonly effective: string | null
  /** The primary text. Null whenever `quote_status` is not verified_primary. */
  readonly text: string | null
  readonly quote_status: QuoteStatus
  /** Where the text was read, so a human can re-verify without asking anyone. */
  readonly source: string
  /**
   * Our own summary of what the rule does to us. Always our words, never presented as the rule's.
   * This is the field a paraphrase belongs in.
   */
  readonly argument?: string
  /**
   * False when the citation names a document revision that advances without notice. Such a label
   * needs a live current-revision check before it reaches a customer.
   */
  readonly bare_revision_customer_renderable?: boolean
  /** Why the revision pin is still safe to build against, when one is pinned. */
  readonly revision_note?: string
}

const RESEARCH = '/Users/user/project-x/03-findings'
const SPINE = `${RESEARCH}/research/surplus-material-traceability-compliance.md`
const MECHANICS = `${RESEARCH}/research/dla-procurement-mechanics.md`
const CHARTER_4_7Z = '/Users/user/onlysource-build/HANDOFFS/T5-DOCUMENTS.md section 4.7Z'

/**
 * THE REGISTRY.
 *
 * Read as data, not as prose: each entry is the text a contracting officer applies, pinned to where
 * we read it. Where a quote carries an ellipsis, the ellipsis is in our source too and is preserved
 * rather than filled in, because reconstructing the elided words would be the exact fabrication this
 * module prevents.
 */
export const RULES = {
  // ---------------------------------------------------------------- the fork that decides everything
  c04_carve_out: {
    id: 'c04_carve_out',
    authority: 'DLAD',
    identifier: '11.390(a), procurement note C04',
    title: 'Unused Former Government Surplus Property',
    effective: 'SEP 2021',
    text:
      'This only applies to offers of Government surplus material. Offers of commercial surplus, ' +
      "manufacturer's overruns, residual inventory resulting from terminated Government contracts, " +
      'and any other material that meets the technical requirements in the solicitation but was not ' +
      'previously owned by the Government will be evaluated in accordance with the DLAD procurement ' +
      'note L04, Offers for Part Numbered Items.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 0`,
    argument:
      'The classifier input is who owned the material before us, not whether the material is unused. ' +
      'Everything new and unused that the Government never owned is an L04 matter, not a C04 matter.',
  },
  c04_acceptability: {
    id: 'c04_acceptability',
    authority: 'DLAD',
    identifier: '11.390(a), procurement note C04, item (1)',
    title: 'Unused Former Government Surplus Property',
    effective: 'SEP 2021',
    text:
      'The material is new, unused, and not of such age or so deteriorated as to impair its ' +
      'usefulness or safety.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 1.2`,
    argument:
      'There is no numeric age ceiling in the regulation. Age is an Engineering Support Activity ' +
      'judgment, so never build an age constant; carry manufacture year and calibrate against outcomes.',
  },
  c04_provenance_proofs: {
    id: 'c04_provenance_proofs',
    authority: 'DLAD',
    identifier: '11.390(a), procurement note C04',
    title: 'Unused Former Government Surplus Property, acceptable provenance evidence',
    effective: 'SEP 2021',
    text:
      'For national or local sales, conducted by sealed bid, spot bid or auction methods, a ' +
      'solicitation/Invitation For Bid and corresponding DLA Disposition Services Form 1427, Notice ' +
      'of Award, Statement and Release Document. For DLA Disposition Services Commercial Venture ' +
      '(CV) Sales, the shipment receipt/delivery pass document and invoices/receipts used by the ' +
      'original purchaser to resell the material. When the above documents are not available, or if ' +
      'they do not identify the specific NSN being acquired, a copy or facsimile of all original ' +
      'package markings and data, including NSN, commercial and Government entity (CAGE) code and ' +
      'part number, and original contract number. When none of the above are available, other ' +
      'information to demonstrate that the offered material was previously owned by the Government. ' +
      'Describe and/or attach.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 2`,
    argument:
      'These four are a descending ladder, not a set. Rungs 1 and 2 exist only for a purchaser at the ' +
      'government sale itself; a dealer buying from another dealer usually reaches only rung 3, the ' +
      'package markings, and only if somebody photographed the package before it was repacked.',
  },
  c04_24_hour_clock: {
    id: 'c04_24_hour_clock',
    authority: 'DLAD',
    identifier: '11.390(b)(2)',
    title: 'Surplus material, request for additional documentation',
    effective: null,
    text:
      'shall allow the offeror 24 hours to submit the additional documentation. If the offeror fails ' +
      'to respond in a 24-hour period, the offer will be deemed unacceptable and evaluation will ' +
      'proceed to the next in line offer, unless it is the only offer.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 2`,
    argument:
      'The text says 24 hours and does not say business hours. We register the calendar reading, ' +
      'which is the earlier instant, and display both readings with their sources.',
  },

  // ---------------------------------------------------------------- the L04 path
  l04_exact_product: {
    id: 'l04_exact_product',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(b)',
    title: 'Offers for Part Numbered Items',
    effective: 'SEP 2016',
    text:
      'a product described by the name of an approved source and its corresponding part number cited ' +
      'in the item description; and manufactured by, or under the direction of, that approved source.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 3`,
  },
  l04_superseding: {
    id: 'l04_superseding',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(d)',
    title: 'Offers for Part Numbered Items, superseding part number',
    effective: 'SEP 2016',
    text:
      'The offeror must indicate that a superseding part number is being offered if the offered item ' +
      'otherwise qualifies as an exact product, except that the part number cited in the item ' +
      'description has been superseded due to an administrative part number change with no change in ' +
      'configuration of the item.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 10`,
    argument:
      'Direction is the whole case. L04(d) covers the item description citing an OLD number and the ' +
      'offeror supplying the NEW one. Offering the superseded number against a current description is ' +
      'the opposite, and by elimination it is an alternate product unless it was previously approved.',
  },
  l04_previously_approved: {
    id: 'l04_previously_approved',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(e)',
    title: 'Offers for Part Numbered Items, previously-approved product',
    effective: 'SEP 2016',
    text:
      'The offeror must indicate that a previously-approved product is being offered if the product ' +
      'offered has previously been delivered to the Government or otherwise previously evaluated and ' +
      'approved.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 10`,
    argument:
      'This is the escape hatch from an alternate-offer exclusion, and it is a database lookup: has ' +
      'this part number ever been delivered under this stock number.',
  },
  l04_alternate_is_alternate: {
    id: 'l04_alternate_is_alternate',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(c)(2)',
    title: 'Offers for Part Numbered Items, alternate offer',
    effective: 'SEP 2016',
    text: 'An offer of an alternate product is an alternate offer.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 10`,
  },
  l04_traceability_2_day: {
    id: 'l04_traceability_2_day',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(g)(1)',
    title: 'Offers for Part Numbered Items, traceability documentation',
    effective: 'SEP 2016',
    text: 'within 2 days, or as otherwise specified, or the offer will not be considered',
    quote_status: 'verified_primary',
    source: `${SPINE} section 3`,
  },
  l04_alternate_data_10_day: {
    id: 'l04_alternate_data_10_day',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(h)(1)',
    title: 'Offers for Part Numbered Items, alternate offer data',
    effective: 'SEP 2016',
    text: 'must be submitted within 10 days, or as otherwise specified, or the offer will not be considered.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 3`,
  },
  l04_distributor_agreement: {
    id: 'l04_distributor_agreement',
    authority: 'DLAD',
    identifier: '11.391(b), procurement note L04(g)',
    title: 'Offers for Part Numbered Items, authorized dealer or distributor evidence',
    effective: 'SEP 2016',
    text:
      'a copy of the contractual agreement with, or the express written authority of, the approved ' +
      'source ... If the agreement covers a general product line or is otherwise not product-specific, ' +
      'the offeror must furnish additional documentation to address the exact item being acquired.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 3`,
    argument:
      'A general product-line agreement is not sufficient on its own, so the agreement record carries ' +
      'an explicit item-specific flag rather than a boolean "we have an agreement".',
  },

  // ---------------------------------------------------------------- 11.392, read as a specification
  dlad_11392_redaction: {
    id: 'dlad_11392_redaction',
    authority: 'DLAD',
    identifier: '11.392',
    title: 'Supply chain traceability documentation',
    effective: null,
    text:
      'The contracting officer shall reject redacted traceability documentation and notify the offeror ' +
      'or contractor. In all cases, any traceability documentation provided by offerors or contractors ' +
      'shall be treated as proprietary information and stamped accordingly.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 4.4`,
    argument:
      'There is no redaction feature on the government traceability path, for anyone, at any role. The ' +
      'protection the operator actually wants is the proprietary stamp, which the same sentence grants.',
  },
  dlad_11392_alteration: {
    id: 'dlad_11392_alteration',
    authority: 'DLAD',
    identifier: '11.392, authenticity check 3',
    title: 'Supply chain traceability documentation, document authenticity',
    effective: null,
    text: 'There is no evidence of alteration, such as cutting and pasting/white out/scanning',
    quote_status: 'verified_primary',
    source: `${SPINE} section 4.3`,
  },
  dlad_11392_shaded_areas: {
    id: 'dlad_11392_shaded_areas',
    authority: 'DLAD',
    identifier: '11.392, authenticity check 11',
    title: 'Supply chain traceability documentation, document authenticity',
    effective: null,
    text:
      'Documents do not have shaded areas, which may indicate information was covered up and the ' +
      'document recopied',
    quote_status: 'verified_primary',
    source: `${SPINE} section 4.3`,
  },
  dlad_11392_disclaimers: {
    id: 'dlad_11392_disclaimers',
    authority: 'DLAD',
    identifier: '11.392, authenticity check 13',
    title: 'Supply chain traceability documentation, document authenticity',
    effective: null,
    text:
      'There are no disclaimers in the document (e.g., stating parts cannot be traced to the actual ' +
      'manufacturer or to any specific revision of the part, etc.)',
    quote_status: 'verified_primary',
    source: `${SPINE} section 4.3`,
    argument:
      'The highest-yield check for this business. Broker paperwork routinely carries exactly this ' +
      'language, because it protects the broker, and its presence is an automatic rejection.',
  },
  cdap_complete_line_of_ownership: {
    id: 'cdap_complete_line_of_ownership',
    authority: 'DLA Counterfeit Detection and Avoidance Program',
    identifier: 'Supply Chain Traceability Documentation Requirements and Examples, paragraph (4.2.24)',
    title: 'Complete line of ownership',
    effective: 'SEP 2016',
    text:
      'If the offered items are not obtained directly from an approved source, or from an authorized ' +
      'dealer/distributor of an approved source, the contractor shall maintain documentation, as ' +
      'described in paragraph (4.2), sufficient to establish the complete line of ownership or ' +
      'distribution from the approved source, or from an authorized dealer/distributor for the ' +
      'approved source, to the offeror/contractor.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 5`,
    argument:
      'Complete means every hop. An invoice from the dealer we bought from proves one hop and says ' +
      'nothing about the hop above it, so the chain is a list of hops each either evidenced or open.',
  },
  cdap_minimum_fields: {
    id: 'cdap_minimum_fields',
    authority: 'DLA Counterfeit Detection and Avoidance Program',
    identifier: 'Supply Chain Traceability Documentation Requirements and Examples, paragraph (2)',
    title: 'Minimum traceability content',
    effective: 'SEP 2016',
    text:
      'At a minimum, the supply chain traceability documentation for the item shall include: basic item ' +
      'description, part number and/or national stock number, manufacturing source, manufacturing ' +
      "source's commercial and government entity code (e.g. CAGE code), and clear identification of " +
      'the name and location of all supply chain intermediaries between the manufacturer to the ' +
      'contractor to item acceptance by the Government. The documentation should also include, where ' +
      "available, the manufacturer's batch identification for the item, such as date codes, lot codes, " +
      'or serial numbers.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 5`,
  },

  // ---------------------------------------------------------------- evaluation cost and exclusions
  m05_evaluation_factors: {
    id: 'm05_evaluation_factors',
    authority: 'DLAD',
    identifier: '11.390(b)(1), procurement note M05',
    title: 'Evaluation factors, surplus and Engineering Support Activity coordination',
    effective: 'SEP 2016',
    text:
      '(1) All offers for unused former Government surplus property shall have a $200 evaluation ' +
      'factor. (2) All offers for CSI require evaluation by the ESA(s). An evaluation factor of $600 ' +
      'shall be applied for coordination with each ESA. (3) If the contracting officer cannot ' +
      'determine acceptability and coordinates with the ESA(s) on other than CSI, an evaluation factor ' +
      'of $600 shall be applied for each ESA.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 2`,
    argument:
      'T3 owns the arithmetic. We surface the two figures on the candidate, because on a small-quantity ' +
      'line the $200 factor can exceed the item price and foreclose the surplus route entirely.',
  },
  m06_alternate_exclusions: {
    id: 'm06_alternate_exclusions',
    authority: 'DLAD',
    identifier: '11.391, procurement note M06',
    title: 'Alternate product, when it will not be evaluated',
    effective: 'SEP 2016',
    text:
      'Offers of alternate product will not be evaluated for the contract action if: (1) The ' +
      'solicitation is automated; (2) It does not meet the dollar threshold for savings, after an ' +
      'evaluation factor of $600 is applied for coordination with each ESA; or (3) When the time ' +
      'proposed for award does not permit evaluation, and delay of award would adversely affect the ' +
      'Government.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 3`,
  },

  // ---------------------------------------------------------------- the Master Solicitation, Rev-81
  ms_alternate_no_automated_award: {
    id: 'ms_alternate_no_automated_award',
    authority: 'DLA Master Solicitation for Automated Simplified Acquisitions',
    identifier: 'Rev-81, Part I, para 3(g)',
    title: 'Alternate offers and automated award',
    effective: null,
    text:
      'Alternate offers will not be considered for automated award. Alternate offers may be submitted ' +
      'for evaluation for future procurements.',
    quote_status: 'verified_primary',
    source: `${MECHANICS} section 5 (para 3(g))`,
    bare_revision_customer_renderable: false,
    revision_note:
      'Cited as Rev-81, the corpus PDF, per the conductor ruling of 2026-08-13. The governing ' +
      'Fast-Auto text is unchanged through Rev-104. A revision number advances without notice, so no ' +
      'customer-facing surface prints one without a live current-revision check at award time.',
    argument:
      'An alternate product cannot win an automated solicitation at any price. Route it to the L04(j) ' +
      'future-evaluation channel instead of pricing it.',
  },
  ms_surplus_ineligible_on_aidc: {
    id: 'ms_surplus_ineligible_on_aidc',
    authority: 'DLA Master Solicitation for Automated Simplified Acquisitions',
    identifier: 'Rev-81, Part II, para 1(a)',
    title: 'Quotations ineligible for automated award on an AIDC solicitation',
    effective: null,
    text:
      'Quoting a used, reconditioned, remanufactured item, or unused former Government surplus property.',
    quote_status: 'verified_primary',
    source: `${MECHANICS} section 5.6`,
    bare_revision_customer_renderable: false,
    revision_note:
      'Cited as Rev-81 per the conductor ruling of 2026-08-13; governing text unchanged through ' +
      'Rev-104. Independently corroborated by the DIBBS batch quote validation rule on field 067.',
    argument:
      'On a U-type AIDC solicitation surplus is disqualified from automated award, which is the ' +
      'opposite of the T-type rule and is detectable from a single character.',
  },
  ms_auto_dq_exceptions: {
    id: 'ms_auto_dq_exceptions',
    authority: 'DLA Master Solicitation for Automated Simplified Acquisitions',
    identifier: 'Rev-81, Part I, para 3(a)(2)',
    title: 'Exceptions that make a quotation ineligible for an automated award',
    effective: null,
    text:
      "(i) Quoting an alternate product or otherwise taking exception to the solicitation's item " +
      'description. (ii) Exceptions to packaging requirements. (iii) Exceptions to FOB terms. (iv) ' +
      'Exceptions to inspection requirements. (v) Exceptions to required quantity. (vi) Quoting a ' +
      "quantity variance greater than specified... (vii) Quoting 'None' when a Higher Level " +
      'Contract Quality Requirement is required. (viii) Quoting the use of Child Labor. (ix) Quoting ' +
      'Remarks.',
    quote_status: 'verified_primary',
    source: CHARTER_4_7Z,
    bare_revision_customer_renderable: false,
    revision_note: 'Cited as Rev-81 per the conductor ruling of 2026-08-13.',
    argument:
      'A single one of these present throws out the automated award. The two an operator trips by ' +
      'habit are (ix) a stray Remark and (vii) None against a Higher-Level Quality requirement.',
  },
  ms_listing_gates: {
    id: 'ms_listing_gates',
    authority: 'DLA Master Solicitation for Automated Simplified Acquisitions',
    identifier: 'Rev-81, Part I, para 3(a)(3)',
    title: 'Qualification list and export control listing requirements',
    effective: null,
    text:
      'The quoted manufacturer must be on the specific Qualified Product List or Qualified ' +
      'Manufacturers List... The quoter must be on the specific Qualified Suppliers List of ' +
      'Distributors or on the Qualified Suppliers List... Export Control (as cited in the item ' +
      'description) requires the applicable certifications to be current for both the quoter and ' +
      'manufacturer.',
    quote_status: 'verified_primary',
    source: CHARTER_4_7Z,
    bare_revision_customer_renderable: false,
    revision_note: 'Cited as Rev-81 per the conductor ruling of 2026-08-13.',
    argument:
      'A listing gap on us OR on our source auto-disqualifies, and both are knowable before the bid. ' +
      'A lapsed export-control certification is the same class of avoidable loss.',
  },

  // ---------------------------------------------------------------- other clocks and gates
  c01_superseded_part_number: {
    id: 'c01_superseded_part_number',
    authority: 'DLAD',
    identifier: 'procurement note C01',
    title: 'Superseded Part Numbered Items',
    effective: 'SEP 2016',
    text:
      'If an item part number is superseded during the term of this contract, the contractor shall ' +
      'advise the contracting officer immediately upon determination. The notice shall include ' +
      'complete information on the superseding item form, fit, function, configuration, application, ' +
      'or physical nature. The contracting officer will determine whether the item is acceptable to ' +
      'the Government, advise the contractor within seven days, and modify the contract accordingly.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 10`,
  },
  far_52_211_5_disclosure: {
    id: 'far_52_211_5_disclosure',
    authority: 'FAR',
    identifier: '52.211-5',
    title: 'Material Requirements',
    effective: 'AUG 2000',
    text:
      'a complete description of the material, the quantity, the name of the Government agency from ' +
      'which acquired, and the date of acquisition',
    quote_status: 'verified_primary',
    source: `${SPINE} section 1.1`,
    argument:
      'These four elements are knowable at purchase time and unobtainable later, which is why the ' +
      'capture flow asks for them when the money moves rather than when a requirement appears.',
  },
  shelf_life_85_percent: {
    id: 'shelf_life_85_percent',
    authority: 'DoD 4140.27-M',
    identifier: 'Section 2-12(A)',
    title: 'Shelf life remaining at receipt',
    effective: null,
    text:
      'Acquisition/procurement documentation shall specify that shelf life items/materiel will have ' +
      'not less than 85 percent (allowing for rounding to whole months) of shelf life remaining at ' +
      'time of receipt by the first government activity.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 9.1, quoted verbatim by the GSA Shelf Life Management Program page`,
    argument:
      'Falling short is a disqualification no price overcomes, not a discount. Type I items are ' +
      'non-extendible; Type II can be extended through inspection, and the fork changes the verdict.',
  },
  gidep_supplier_notice: {
    id: 'gidep_supplier_notice',
    authority: 'GIDEP',
    identifier: 'SD-25, Attachment 7, A7.1.2',
    title: 'Supplier notification before a suspect counterfeit report',
    effective: null,
    text:
      'Notify the supplier (the immediate SOS which sold the parts to the submitting organization), in ' +
      'writing, of your intent to issue a suspect counterfeit report ... Allow a minimum of 15 working ' +
      'days for the supplier to respond.',
    quote_status: 'verified_primary',
    source: `${SPINE} section 12`,
    argument:
      'Inbound, this notice is the only warning before three years of SPRS damage, and it arrives as ' +
      'ordinary email. It is a legal emergency, not correspondence.',
  },
  sprs_preview_window: {
    id: 'sprs_preview_window',
    authority: 'SPRS Evaluation Criteria Manual v4',
    identifier: 'section 3.1.1',
    title: 'Negative record preview period',
    effective: 'APR 2024',
    text:
      'Negative records observe an initial 14-day preview period where they are held out of scoring. ' +
      'This allows vendors to review and challenge records they believe to be inaccurate before there ' +
      'is a scoring impact.',
    quote_status: 'verified_primary',
    source: `${RESEARCH}/edge/traceability-automation.md section 5.4`,
    argument:
      'A negative record challenged inside 14 days never touches the score. One caught on day 20 ' +
      'decays linearly over 1,095 days. T6 owns the daily poll; this lane owns the challenge evidence.',
  },

  // ---------------------------------------------------------------- QUARANTINED
  c03_retention: {
    id: 'c03_retention',
    authority: 'DLAD',
    identifier: '4.703, procurement note C03',
    title: 'Contractor Retention of Supply Chain Traceability Documentation',
    effective: 'JUN 2020',
    text: null,
    quote_status: 'unverified_pending_primary_pull',
    source:
      `${SPINE} section 5 records the six-year retention term and the note's existence. The exact ` +
      'clause wording was not captured in any research digest and is quarantined by the conductor ' +
      'ruling of 2026-08-13 pending a dedicated primary-text pull.',
    argument:
      'Submitting a quote is itself a standing certification that the traceability chain exists or ' +
      'will exist before delivery, and that it will be retained. The consequence is the whole ' +
      "sequencing argument for this lane: if the chain is not captured at intake, the company is out " +
      'of compliance at quote time rather than at request time. The retention term is six years after ' +
      'final payment on the current text and ten in the Sept 2016 CDAP document, so it is parsed from ' +
      'the award and never hardcoded.',
  },
} as const satisfies Record<string, RuleCitation>

export type RuleId = keyof typeof RULES

// ---------------------------------------------------------------------------------------------------
// ACCESS, GUARDED
// ---------------------------------------------------------------------------------------------------

export type QuotationRefusal = {
  readonly ok: false
  /** Machine-readable so a surface can branch, and a human sentence so a surface can render. */
  readonly reason: 'unverified_pending_primary_pull'
  readonly rule_id: string
  readonly identifier: string
  /** What the caller may show instead. Our words, plainly ours. */
  readonly argument_instead: string | null
  readonly statement: string
}

export type QuotationGranted = {
  readonly ok: true
  readonly quote: VerifiedQuote
  readonly rule_id: string
  readonly identifier: string
  readonly authority: string
  readonly effective: string | null
  readonly source: string
}

/**
 * The only way to obtain quotable regulation text.
 *
 * Returns a refusal rather than throwing, because an unverified citation is a normal, expected,
 * shippable state that a surface must render honestly, not an exceptional one. Throwing would push
 * callers toward a try/catch that swallows the distinction, and the distinction is the point.
 */
export function quotationOf(rule: RuleCitation): QuotationGranted | QuotationRefusal {
  if (rule.quote_status !== 'verified_primary' || rule.text === null) {
    return {
      ok: false,
      reason: 'unverified_pending_primary_pull',
      rule_id: rule.id,
      identifier: rule.identifier,
      argument_instead: rule.argument ?? null,
      statement:
        `The exact wording of ${rule.authority} ${rule.identifier} has not been read in the primary ` +
        'source, so it cannot be shown as a quotation. What this rule requires of us is summarised ' +
        'in our own words instead.',
    }
  }
  return {
    ok: true,
    quote: rule.text as VerifiedQuote,
    rule_id: rule.id,
    identifier: rule.identifier,
    authority: rule.authority,
    effective: rule.effective,
    source: rule.source,
  }
}

export type Audience = 'internal' | 'customer'

/**
 * Evidence that somebody checked the live current revision of a moving-target document. Deliberately
 * carries who and when: "we checked" with no name and no instant is not a check.
 */
export type LiveRevisionCheck = {
  readonly checked_revision: string
  readonly checked_at: string
  readonly checked_by: string
}

export type LabelRefusal = {
  readonly ok: false
  readonly reason: 'bare_revision_needs_live_check'
  readonly statement: string
}

/**
 * Render the citation label a surface prints beside a verdict.
 *
 * An internal label always renders: the operator is entitled to see exactly what we built against.
 * A customer label for a revision-pinned document requires a live check, because printing "Rev-81" to
 * a customer asserts that Rev-81 is current, and revisions advance without telling us.
 */
export function citationLabel(
  rule: RuleCitation,
  opts: { audience: Audience; liveCheck?: LiveRevisionCheck },
): { ok: true; label: string } | LabelRefusal {
  const base = `${rule.authority} ${rule.identifier}`
  const dated = rule.effective ? `${base} (${rule.effective})` : base

  if (opts.audience === 'internal') return { ok: true, label: dated }

  if (rule.bare_revision_customer_renderable === false) {
    if (!opts.liveCheck) {
      return {
        ok: false,
        reason: 'bare_revision_needs_live_check',
        statement:
          `${base} pins a document revision that advances without notice. Confirm the current ` +
          'revision at award time before this citation goes to a customer.',
      }
    }
    return {
      ok: true,
      label:
        `${rule.authority} ${rule.identifier}, confirmed current as ` +
        `${opts.liveCheck.checked_revision} on ${opts.liveCheck.checked_at}`,
    }
  }
  return { ok: true, label: dated }
}

/** Every rule whose text we still owe a primary-text pull. Rendered on an internal honesty panel. */
export function quarantinedCitations(): readonly RuleCitation[] {
  return Object.values(RULES).filter((r) => r.quote_status !== 'verified_primary')
}
