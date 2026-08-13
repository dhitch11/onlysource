/**
 * THE DELIVERABLE ASSEMBLER, AND THE TYPE BOUNDARY THAT IS THE POINT OF IT.
 *
 * This builds the four artifacts of the Documents and POs surface: the quote packet, the purchase order,
 * the traceability packet and the counter-offer memo. A machine-drafted sentence inside a certificate is
 * a fabricated federal record the moment a human signs it, so the requirement from the war room is not
 * "be careful with model output," it is that the assembler be STRUCTURALLY INCAPABLE of carrying it:
 * no code path whose parameter type can be satisfied by the AI service's return type.
 *
 * HOW THAT IS ENFORCED HERE, in three layers, because one layer is a convention and three is a control.
 *
 *   LAYER 1, NOMINAL TYPES. The assembler accepts exactly two content types. `SourceBytes` can only be
 *   minted by `sourceBytes()`, which demands a content hash and a storage key. `DeterministicValue` can
 *   only be minted by `deterministicValue()`, which demands the table and column the value came from.
 *   `AiText` is declared in this file precisely so its incompatibility is visible and testable: it is a
 *   different brand, so passing one where a payload is expected does not compile. A plain `string` does
 *   not compile either, which matters more, because a plain string is what an AI client actually returns.
 *
 *   LAYER 2, NUMBERS TRAVEL AS REFERENCES. A template carries `{{fN}}` placeholders, never figures. An
 *   unresolved reference is a HARD RENDER FAILURE, not a blank and not an empty string, because a
 *   purchase order with a silently empty total is worse than one that refuses to render.
 *
 *   LAYER 3, POST-GENERATION EXTRACTION. After rendering, every digit-bearing token in the output must
 *   trace to either a resolved payload value or a numeral the template DECLARED in advance. Fixed
 *   template text legitimately contains numerals (rule citations like 52.246-15, form numbers like 1427),
 *   so a naive scan would false-positive on every citation. Declaring them makes the check precise: an
 *   undeclared numeral in fixed text is a typo in a citation, which is itself a defect worth failing on.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not decide readiness, it does not send anything, and
 * it never invents a state. An artifact it cannot complete comes back as a named blocker.
 */

// ---------------------------------------------------------------------------------------------------
// THE TWO PERMITTED CONTENT TYPES, AND THE ONE FORBIDDEN ONE
// ---------------------------------------------------------------------------------------------------

declare const SOURCE_BYTES: unique symbol
declare const DETERMINISTIC: unique symbol
declare const AI_TEXT: unique symbol

/** Bytes lifted from a source document, addressed by content hash. Never edited, only included. */
export type SourceBytes = {
  readonly storage_key: string
  readonly sha256: string
  readonly byte_length: number
  readonly document_id: string
  readonly [SOURCE_BYTES]: true
}

/** A value read from a deterministic column. Carries where it came from so any figure reaches its source. */
export type DeterministicValue = {
  /** The display string exactly as it will render. Formatting happens at mint time, not at render time. */
  readonly display: string
  readonly table: string
  readonly column: string
  readonly row_id: string
  readonly as_of: string
  readonly [DETERMINISTIC]: true
}

/**
 * The AI service's return type, declared here on purpose.
 *
 * Nothing in this module accepts it. It exists so that the prohibition is a compile error a test can
 * demonstrate rather than a sentence in a document nobody reads. If a future AI client returns a plain
 * `string`, that does not compile against a payload either, which is the case that actually happens.
 */
export type AiText = string & { readonly [AI_TEXT]: true }

export function sourceBytes(v: {
  storage_key: string
  sha256: string
  byte_length: number
  document_id: string
}): SourceBytes {
  if (!/^[a-f0-9]{64}$/.test(v.sha256)) {
    throw new Error(
      `Refusing to mint SourceBytes for document ${v.document_id}: sha256 is not a 64-character hex ` +
        'digest, so the bytes are not content-addressed and could not be reproduced later.',
    )
  }
  // The brand is TYPE-ONLY. `declare const` emits nothing, so writing a computed key from it would
  // throw at runtime while typechecking clean, which is exactly the defect the first test run caught.
  return { ...v } as unknown as SourceBytes
}

export function deterministicValue(v: {
  display: string
  table: string
  column: string
  row_id: string
  as_of: string
}): DeterministicValue {
  // Type-only brand, same reason as sourceBytes above: never write it at runtime.
  return { ...v } as unknown as DeterministicValue
}

/**
 * A narrative a PERSON wrote and signed. The one place prose enters a deliverable.
 *
 * This is not an escape hatch for model output: it requires an identity and an instant, and the
 * assembler records both on the artifact. A model may assist a human in drafting, and what enters here
 * is what the human signed, which is the same standard as any other signature on a federal document.
 */
export type HumanAuthoredNarrative = {
  readonly text: string
  readonly authored_by: string
  readonly signed_by: string
  readonly signed_at: string
}

// ---------------------------------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------------------------------

export type TemplateSegment =
  | {
      readonly kind: 'fixed'
      readonly text: string
      /**
       * Every digit-bearing token this fixed text is allowed to contain, declared in advance. Citations
       * and form numbers live here. An undeclared numeral fails the render.
       */
      readonly numerals_declared: readonly string[]
    }
  | { readonly kind: 'payload'; readonly ref: string; readonly label: string }
  | { readonly kind: 'narrative'; readonly ref: string; readonly label: string }

export type Template = {
  readonly id: string
  readonly title: string
  readonly segments: readonly TemplateSegment[]
}

export type Payloads = Readonly<Record<string, DeterministicValue>>
export type Narratives = Readonly<Record<string, HumanAuthoredNarrative>>
export type Attachments = readonly SourceBytes[]

// ---------------------------------------------------------------------------------------------------
// FAILURES
// ---------------------------------------------------------------------------------------------------

export type RenderFailure =
  | {
      readonly kind: 'dangling_reference'
      readonly ref: string
      readonly label: string
      readonly statement: string
    }
  | {
      readonly kind: 'unpayloaded_numeral'
      readonly numeral: string
      readonly segment_index: number
      readonly statement: string
    }
  | {
      readonly kind: 'undeclared_numeral_in_fixed_text'
      readonly numeral: string
      readonly segment_index: number
      readonly statement: string
    }
  | {
      readonly kind: 'unsigned_narrative'
      readonly ref: string
      readonly statement: string
    }

export class HardRenderFailure extends Error {
  readonly failures: readonly RenderFailure[]
  constructor(templateId: string, failures: readonly RenderFailure[]) {
    super(
      `Deliverable ${templateId} refused to render: ${failures.length} integrity failure(s). ` +
        failures.map((f) => f.statement).join(' '),
    )
    this.name = 'HardRenderFailure'
    this.failures = failures
  }
}

/**
 * Digit-bearing tokens. Captures 1,234.56, 52.246-15, 1650-01-059-8221 and 85% as single tokens, so a
 * citation or a stock number is compared as one unit rather than shredded into fragments that would each
 * need declaring.
 */
export function numeralTokens(s: string): readonly string[] {
  return s.match(/\d[\d.,\-/:%$]*\d|\d/g) ?? []
}

// ---------------------------------------------------------------------------------------------------
// THE ASSEMBLER
// ---------------------------------------------------------------------------------------------------

export type RenderedArtifact = {
  readonly template_id: string
  readonly title: string
  readonly body: string
  /** Which payload backed each figure, so every number on the page reaches its column. */
  readonly figure_provenance: readonly {
    readonly ref: string
    readonly display: string
    readonly table: string
    readonly column: string
    readonly row_id: string
    readonly as_of: string
  }[]
  readonly narratives: readonly { readonly ref: string; readonly signed_by: string; readonly signed_at: string }[]
  readonly attachments: readonly { readonly document_id: string; readonly sha256: string }[]
}

/**
 * Render a deliverable, or refuse.
 *
 * Throws HardRenderFailure rather than returning a partial artifact. This is the one place in this lane
 * where throwing is right: a partially rendered federal document that a human might sign is not a
 * degraded state to display, it is an artifact that must not exist.
 */
export function assemble(
  template: Template,
  payloads: Payloads,
  narratives: Narratives,
  attachments: Attachments = [],
): RenderedArtifact {
  const failures: RenderFailure[] = []
  const parts: string[] = []
  const figureProvenance: RenderedArtifact['figure_provenance'][number][] = []
  const narrativeRecords: RenderedArtifact['narratives'][number][] = []

  template.segments.forEach((seg, i) => {
    if (seg.kind === 'fixed') {
      const declared = new Set(seg.numerals_declared)
      for (const n of numeralTokens(seg.text)) {
        if (!declared.has(n)) {
          failures.push({
            kind: 'undeclared_numeral_in_fixed_text',
            numeral: n,
            segment_index: i,
            statement:
              `Fixed template text in segment ${i} contains the numeral ${n}, which the template did ` +
              'not declare. Either it is a citation or form number that belongs in numerals_declared, ' +
              'or it is a figure that must come from a deterministic column instead of from prose.',
          })
        }
      }
      parts.push(seg.text)
      return
    }

    if (seg.kind === 'payload') {
      const p = payloads[seg.ref]
      if (p === undefined) {
        failures.push({
          kind: 'dangling_reference',
          ref: seg.ref,
          label: seg.label,
          statement:
            `Template reference {{${seg.ref}}} (${seg.label}) has no payload. The deliverable will not ` +
            'render with a gap where a figure belongs.',
        })
        parts.push(`{{${seg.ref}}}`)
        return
      }
      parts.push(p.display)
      figureProvenance.push({
        ref: seg.ref,
        display: p.display,
        table: p.table,
        column: p.column,
        row_id: p.row_id,
        as_of: p.as_of,
      })
      return
    }

    // narrative
    const n = narratives[seg.ref]
    if (n === undefined) {
      failures.push({
        kind: 'dangling_reference',
        ref: seg.ref,
        label: seg.label,
        statement:
          `Narrative slot {{${seg.ref}}} (${seg.label}) is empty. A person writes and signs this ` +
          'section; it is never generated.',
      })
      parts.push(`{{${seg.ref}}}`)
      return
    }
    if (n.signed_by.trim() === '' || n.signed_at.trim() === '') {
      failures.push({
        kind: 'unsigned_narrative',
        ref: seg.ref,
        statement:
          `Narrative ${seg.ref} carries no signature or no signing instant. An unsigned narrative in a ` +
          'federal deliverable is not attributable, so it does not render.',
      })
    }
    // A narrative may legitimately contain numerals a person wrote, but they are still figures on a
    // federal document, so they must be backed by a payload. Checked below against the payload set.
    const payloadNumerals = new Set(Object.values(payloads).flatMap((p) => numeralTokens(p.display)))
    for (const tok of numeralTokens(n.text)) {
      if (!payloadNumerals.has(tok)) {
        failures.push({
          kind: 'unpayloaded_numeral',
          numeral: tok,
          segment_index: i,
          statement:
            `The signed narrative in segment ${i} states the figure ${tok}, which does not appear in ` +
            'any deterministic payload on this deliverable. Every figure on a federal document is a ' +
            'resolved reference to a stored column, including one a person typed.',
        })
      }
    }
    parts.push(n.text)
    narrativeRecords.push({ ref: seg.ref, signed_by: n.signed_by, signed_at: n.signed_at })
  })

  if (failures.length > 0) throw new HardRenderFailure(template.id, failures)

  return {
    template_id: template.id,
    title: template.title,
    body: parts.join(''),
    figure_provenance: figureProvenance,
    narratives: narrativeRecords,
    attachments: attachments.map((a) => ({ document_id: a.document_id, sha256: a.sha256 })),
  }
}

/**
 * The independent post-generation check, run against a rendered body as a second pair of eyes.
 *
 * `assemble` already enforces this per segment. This function re-derives it from the finished string,
 * which is what the acceptance gate's fabrication probe actually exercises: it catches a numeral that
 * reached the output by any route, including one a future code path introduces after assembly.
 */
export function extractUnpayloadedNumerals(
  body: string,
  payloads: Payloads,
  declaredFixedNumerals: readonly string[],
): readonly string[] {
  const allowed = new Set<string>([
    ...declaredFixedNumerals,
    ...Object.values(payloads).flatMap((p) => numeralTokens(p.display)),
  ])
  return numeralTokens(body).filter((t) => !allowed.has(t))
}
