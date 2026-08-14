/**
 * T5's ENTRIES FOR THE HELP REGISTRY. The lane that owns the verdict owns the sentence.
 *
 * Kept in a file this lane owns and imported by `components/help/registry.ts`, per T8's note, so
 * that file does not become a merge conflict every lane fights over.
 *
 * This content is written by hand and never generated. On this surface an unexplained verdict costs
 * an award, and the reader is an expert who has never read the regulation that just blocked him, so
 * the explanation is the product rather than decoration around it.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE FIFTH FIELD IS HERE, AND WHAT IT COST TO GET IT
 * ---------------------------------------------------------------------------------------------
 * `HelpRecord` had four content fields when this file was written: what, how, why, source. Quality
 * Bar G2 requires all five including `what_this_does_not_do`, and acceptance gate R9.4 names that one
 * explicitly as what the coverage lint must check, so R9.4 could not have passed and eight lanes were
 * about to write content against a type that structurally could not hold it. Rather than drop the
 * content or quietly fold it into `why`, it was written anyway and parked in a keyed map, which is
 * what made the gap visible instead of absent. Reported to T8 rather than patched from this lane;
 * they added `whatThisDoesNotDo` and `explainsAScore` the same day and the content moved across
 * unchanged. `explainsAScore` is false on every entry here: these explain states and verdicts rather
 * than figures somebody acts on financially, and claiming otherwise would make their gate fire on
 * the wrong rows.
 */

import type { HelpRecord } from '@/components/help/registry'

export const T5_ENTRIES: HelpRecord[] = [
  {
    id: 'compliance.path',
    owner: 'T5 DOCUMENTS',
    title: 'Compliance path',
    what: 'Which of the two legal products this lot is, which decides the document set and the clock.',
    how:
      'Read the path first, before anything else on the lot. C04 means we can show the Government ' +
      'owned this material before us, and the nine-block representation goes out with the offer. L04 ' +
      'means we cannot show that, so the evidence needed is traceability back to the approved ' +
      'manufacturing source with every intermediary named. If it says not classified, nothing may be ' +
      'drafted yet and the missing fact is named underneath.',
    why:
      'Quoting broker stock as surplus under C04 invites a request for a disposition document that ' +
      'does not exist, and the offer dies on the spot. The two paths also carry different clocks: 24 ' +
      'hours on C04, 2 days on L04.',
    source:
      'Computed by deterministic code from the recorded material condition, the acquisition channel ' +
      'and the provenance documents on the lot. No language model touches it. The rule that decided ' +
      'it is quoted on the verdict with its identifier and effective date.',
    whatThisDoesNotDo:
      'It does not tell you whether the material is any good, whether the price is right, or ' +
      'whether the offer will win. It answers one question: which document set this lot needs. It ' +
      'also does not decide anything about used, reconditioned or remanufactured material, which is ' +
      'a conversation with the product specialist rather than a classification.',
  },
  {
    id: 'compliance.provenance_rung',
    owner: 'T5 DOCUMENTS',
    title: 'Provenance rung',
    what: 'Which of the four accepted proofs of prior Government ownership this lot can actually produce.',
    how:
      'Rung 1 is strongest and rung 4 is an argument a person signs. Read the gap line underneath: it ' +
      'names the document that would move this lot one rung up. Ask for that document at buy time, ' +
      'because the rung you can reach is decided by where you bought, not by paperwork done later.',
    why:
      'Rung is a sourcing decision worth real money. A dealer-to-dealer purchase reaches rung 3 at ' +
      'best, and only if somebody photographed the original package before it was repacked. The same ' +
      'material bought at a disposition sale reaches rung 1.',
    source:
      'The four rungs are quoted from procurement note C04 at DLAD 11.390(a). Which rung is satisfied ' +
      'is computed from the documents attached to this lot, and an unconfirmed field does not satisfy ' +
      'a rung.',
    whatThisDoesNotDo:
      'It does not prove the Government owned this material. It reports which proof we currently ' +
      'hold. It cannot tell you a contracting officer will accept that proof, and on rung 4 the ' +
      'argument is only as good as the person who signed it.',
  },
  {
    id: 'packet.state',
    owner: 'T5 DOCUMENTS',
    title: 'Deliverable state',
    what: 'Whether this document exists, is waiting on a person, or cannot be built yet.',
    how:
      'Ready to submit means the artifact was assembled and nothing is blocking it. Draft means it ' +
      'assembled and is held, either by an open compliance blocker or because it needs a person. ' +
      'Generate from blueprint means no artifact exists yet, and the field it is missing is named.',
    why:
      'A packet that reports ready when no artifact exists is the defect that costs a firm its ' +
      'standing with a buyer, because it is discovered at the moment the document is demanded.',
    source:
      'Computed at request time by resolving the required fields against what is captured, then ' +
      'attempting the assembly. Readiness requires an assembly that succeeded, never field presence ' +
      'alone. There is no control anywhere that lets a person mark a packet ready.',
    whatThisDoesNotDo:
      'Ready to submit does not mean the offer is compliant, competitive or wise. It means the ' +
      'artifact exists, every figure in it traces to a stored value, and no compliance blocker is ' +
      'open. It says nothing about price, quantity sufficiency against a specific requirement, or ' +
      'whether a person has read it.',
  },
  {
    id: 'traceability.preflight',
    owner: 'T5 DOCUMENTS',
    title: 'Zero-rejection pre-flight',
    what: 'Whether the automated evaluation would accept this quote at all, before a sourcing hour is spent.',
    how:
      'Clear means no exception, no listing gap, and the solicitation type does not exclude this ' +
      'material. Blocked names the failing field and quotes the rule. Cannot assess means a fact ' +
      'needed for a hard gate has not been delivered, so treat it as unchecked rather than as safe.',
    why:
      'One red field auto-rejects a quote with no recourse and no notice, on exactly the deals that ' +
      'pay the most. The two tripped by habit are a stray Remark on the quote and answering None to a ' +
      'Higher Level Quality requirement.',
    source:
      'The exception list, the listing gates and the solicitation-type branch are quoted from the DLA ' +
      'Master Solicitation, Revision 81, read from the PDF rather than from a summary. Each finding ' +
      'names the paragraph it came from.',
    whatThisDoesNotDo:
      'It does not predict whether we win, and it does not check price. It checks only whether the ' +
      'quote is qualified enough to be in the comparison. It also cannot see fields the ingestion ' +
      'lane has not delivered, which is why it reports cannot assess rather than clear.',
  },
  {
    id: 'traceability.surplus_type_branch',
    owner: 'T5 DOCUMENTS',
    title: 'The T versus U branch',
    what: 'On a one-time buy surplus is award-eligible. On an AIDC buy it is disqualifying.',
    how:
      'Check the type character before committing effort to a surplus candidate. If it is U, this ' +
      'material cannot win an automated award at any price, and the right move is a one-time buy for ' +
      'the same stock number or the future-evaluation channel.',
    why:
      'This is the opposite of what most people assume, and it is detectable from a single character. ' +
      'Getting it backwards spends sourcing effort on quotes the machine will never accept.',
    source:
      'The identical sentence appears in Part I 3(a)(1)(iii) as not an exception and in Part II 1(a) ' +
      'as one that disqualifies, and Part II applies when a U solicitation. Both paragraphs are ' +
      'registered separately, and the gate keys on the instrument type rather than on the wording.',
    whatThisDoesNotDo:
      'It does not decide whether to bid. It reports one hard gate. A T-type buy being open to ' +
      'surplus says nothing about whether this lot is the right material or the right price.',
  },
  {
    id: 'compliance.figure_provenance',
    owner: 'T5 DOCUMENTS',
    title: 'Where this figure came from',
    what: 'Every number on a generated document is a reference to a stored value, listed with its source.',
    how:
      'Read the provenance table under any rendered artifact. Each row names the reference, the value ' +
      'and the record it was read from. If a reference cannot be resolved, the document refuses to ' +
      'render rather than printing a gap.',
    why:
      'A federal document carrying a figure nobody can trace is a fabricated record the moment a ' +
      'person signs it. The refusal is the feature.',
    source:
      'Resolved from deterministic columns at assembly time. A post-generation check re-reads the ' +
      'finished document and rejects any numeral that does not trace to a payload or to a citation the ' +
      'template declared in advance.',
    whatThisDoesNotDo:
      'It does not verify that a stored value is correct, only that the figure on the page came ' +
      'from one and can be traced back to it. A wrong number captured at intake is still wrong ' +
      'here, which is why identifiers read from a label need a human to confirm them before they ' +
      'carry a verdict.',
  },
]

/**
 * The fifth field is now IN the record above, as `whatThisDoesNotDo`.
 *
 * It lived in a separate map for a few hours because `HelpRecord` had no field for it, which was a
 * real gap: Quality Bar G2 requires all five fields and acceptance gate R9.4 names this one as what
 * the coverage lint must check, so R9.4 could not have passed. Reported to T8 rather than patched
 * from this lane; they added `whatThisDoesNotDo` and `explainsAScore` the same day, and the content
 * moved across unchanged. Recorded here because "write the content anyway and park it" is what made
 * the gap visible instead of quietly absent.
 */
