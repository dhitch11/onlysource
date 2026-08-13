/**
 * PROVENANCE AND CONFIRMATION AS TWO ORTHOGONAL AXES (Quality Bar ruling R1).
 *
 * The war room said "three states, never four." T8 and the voice ruling said UNCONFIRMED is a
 * first-class state. R1 resolved it: both, as orthogonal axes. Provenance is one axis with exactly
 * three glyph states (measured / modeled / insufficient). Confirmation is an overlay that composes with
 * any provenance state. Never a fourth glyph, never a bolted-on badge.
 *
 * WHAT THIS MODULE IS ACTUALLY FOR, beyond rendering.
 * The charter's rule is that a low-confidence OCR field must never auto-assert into a compliance
 * determination: "A wrong character in a contract number is a false representation with a signature on
 * it." A rule like that, written as a note, survives exactly until the afternoon somebody wires the OCR
 * output straight into the classifier because the types allowed it.
 *
 * So the types do not allow it. A compliance determination consumes `ConfirmedFact<T>`, which cannot be
 * constructed from an unconfirmed value at all. The only route from unconfirmed to confirmed is
 * `acceptFact()`, which demands a human actor and a timestamp. There is no flag, no override parameter
 * and no admin path, because the ways this gets bypassed in practice are all flags, overrides and admin
 * paths.
 *
 * UNCONFIRMED values are inert to computation, not merely marked. A gate handed one returns
 * `insufficient_data` naming the field, which is a real answer the operator can act on, and never a
 * pass and never a zero.
 */

/**
 * The provenance axis. Exactly three states, forever.
 * - `measured`: read from a primary artifact or a deterministic query result.
 * - `modeled`: computed or inferred by our own deterministic logic from measured inputs.
 * - `insufficient`: we do not have enough to say. An answer, not an absence.
 */
export type ProvenanceState = 'measured' | 'modeled' | 'insufficient'

export const PROVENANCE_STATES: readonly ProvenanceState[] = ['measured', 'modeled', 'insufficient']

/** How each state is described to an operator. One wording, everywhere. */
export const PROVENANCE_LABEL: Readonly<Record<ProvenanceState, string>> = {
  measured: 'Measured. Read directly from the source artifact or record.',
  modeled: 'Modeled. Computed by our own logic from measured inputs.',
  insufficient: 'Insufficient data. Not enough on hand to state this, and we will not guess.',
}

/** Where a value came from, carried so any figure reaches its source within two interactions (G3). */
export type FactSource = {
  /** What kind of artifact or record. */
  readonly kind:
    | 'label_capture_ocr'
    | 'source_document'
    | 'database_column'
    | 'operator_entry'
    | 'call_extraction'
    | 'derived'
  /** The addressable thing: a document hash, a row id, a call sid, a column name. */
  readonly ref: string
  /** ISO 8601. Supplied by the caller from the injected clock; this module never reads wall time. */
  readonly as_of: string
  /** For OCR and call extraction, the extractor's own confidence in this field, 0 to 1. */
  readonly field_confidence?: number
  /** For a call-extracted value, the audio span so a human can listen before accepting. */
  readonly audio_span?: { readonly call_sid: string; readonly start_ms: number; readonly end_ms: number }
}

declare const CONFIRMED: unique symbol

/**
 * A value a human has accepted, or that never needed acceptance because it was measured
 * deterministically. Only this type may reach a compliance determination.
 */
export type ConfirmedFact<T> = {
  readonly value: T
  readonly provenance: ProvenanceState
  readonly source: FactSource
  readonly accepted_by: string | null
  readonly accepted_at: string | null
  readonly [CONFIRMED]: true
}

/**
 * A value extracted but not yet accepted. Renders with its overlay and its audio span or image crop.
 * Inert to every computation and state transition until accepted.
 */
export type UnconfirmedFact<T> = {
  readonly value: T
  readonly provenance: ProvenanceState
  readonly source: FactSource
  readonly unconfirmed: true
  /** Why it needs a human, in operator vocabulary, so the queue explains itself. */
  readonly needs_confirmation_because: string
}

export type Fact<T> = ConfirmedFact<T> | UnconfirmedFact<T>

export function isConfirmed<T>(f: Fact<T>): f is ConfirmedFact<T> {
  return !('unconfirmed' in f)
}

/**
 * The confidence at or below which an extracted field must be confirmed by a human before it can carry
 * a compliance determination.
 *
 * 0.98 is deliberately high and deliberately explicit. The acceptance gate requires identifier
 * precision of at least 0.98 before autonomous consumption, so anything under that threshold is exactly
 * what the gate says a human must still see. This constant is exported so the number is auditable
 * rather than buried in a comparison, and so a test can prove the boundary behaves at 0.98 and 0.9799.
 */
export const IDENTIFIER_CONFIRMATION_THRESHOLD = 0.98

/**
 * A value measured deterministically from a record or a document. Needs no human acceptance because no
 * extraction judgment was involved.
 */
export function measured<T>(value: T, source: FactSource): ConfirmedFact<T> {
  return {
    value,
    provenance: 'measured',
    source,
    accepted_by: null,
    accepted_at: null,
  } as ConfirmedFact<T>
}

/** A value our own deterministic logic computed from measured inputs. */
export function modeled<T>(value: T, source: FactSource): ConfirmedFact<T> {
  return {
    value,
    provenance: 'modeled',
    source,
    accepted_by: null,
    accepted_at: null,
  } as ConfirmedFact<T>
}

/**
 * Wrap an extracted value. This is the ONLY entry point for OCR, call extraction and anything else a
 * model produced, and it returns Unconfirmed whenever confidence is at or below the threshold, or
 * whenever confidence is absent entirely.
 *
 * Absent confidence resolves to Unconfirmed rather than Confirmed. An extractor that forgot to report
 * confidence is not evidence that the field is good; treating a missing number as a passing number is
 * how a column nobody wrote gets read as a measurement.
 */
export function extracted<T>(
  value: T,
  source: FactSource,
  reason: string,
): ConfirmedFact<T> | UnconfirmedFact<T> {
  const c = source.field_confidence
  if (c === undefined || c <= IDENTIFIER_CONFIRMATION_THRESHOLD) {
    return {
      value,
      provenance: 'measured',
      source,
      unconfirmed: true,
      needs_confirmation_because:
        c === undefined
          ? `${reason} The extractor reported no confidence for this field, so it needs a human read.`
          : `${reason} Extractor confidence was ${c.toFixed(2)}, at or below the ${IDENTIFIER_CONFIRMATION_THRESHOLD} threshold for an identifier that carries a determination.`,
    }
  }
  return {
    value,
    provenance: 'measured',
    source,
    accepted_by: null,
    accepted_at: null,
  } as ConfirmedFact<T>
}

/**
 * A human accepts an unconfirmed value. Requires an identity and an instant, because "accepted" with
 * nobody's name on it is not an acceptance, and a false representation needs a signature to be traced.
 *
 * The accepted value may differ from the extracted one: an operator correcting a misread character is
 * the common case, and the correction is what feeds the extractor accuracy ledger.
 */
export function acceptFact<T>(
  f: UnconfirmedFact<T>,
  by: string,
  at: string,
  correctedValue?: T,
): ConfirmedFact<T> {
  return {
    value: correctedValue === undefined ? f.value : correctedValue,
    provenance: f.provenance,
    source: f.source,
    accepted_by: by,
    accepted_at: at,
  } as ConfirmedFact<T>
}

/** A fact we simply do not have. Renders as the third glyph state and blocks gates honestly. */
export function insufficient(field: string, source: FactSource): UnconfirmedFact<null> {
  return {
    value: null,
    provenance: 'insufficient',
    source,
    unconfirmed: true,
    needs_confirmation_because: `${field} has not been captured, so nothing can be asserted from it.`,
  }
}

// ---------------------------------------------------------------------------------------------------
// THE GATE BOUNDARY
// ---------------------------------------------------------------------------------------------------

export type FactRequirementFailure = {
  readonly ok: false
  readonly reason: 'unconfirmed' | 'insufficient'
  readonly field: string
  /** Operator-facing, names the object and the next action (C-F.7). */
  readonly statement: string
  /** What a human must do to unblock it. */
  readonly next_action: string
}

export type FactRequirementSuccess<T> = { readonly ok: true; readonly fact: ConfirmedFact<T> }

/**
 * The only way a compliance gate reads a fact.
 *
 * A gate that calls this and forwards the failure produces `insufficient_data` naming the field. A gate
 * that never calls it cannot read a fact at all, because the fact types are opaque to it. This is what
 * makes "never auto-assert a low-confidence field" structural instead of aspirational.
 */
export function requireConfirmed<T>(
  field: string,
  f: Fact<T> | undefined | null,
): FactRequirementSuccess<T> | FactRequirementFailure {
  if (f === undefined || f === null) {
    return {
      ok: false,
      reason: 'insufficient',
      field,
      statement: `${field} has not been captured on this lot.`,
      next_action: `Capture ${field} at intake, or record why it cannot be obtained.`,
    }
  }
  if (!isConfirmed(f)) {
    if (f.provenance === 'insufficient') {
      return {
        ok: false,
        reason: 'insufficient',
        field,
        statement: `${field} has not been captured on this lot.`,
        next_action: `Capture ${field}, or record why it cannot be obtained.`,
      }
    }
    return {
      ok: false,
      reason: 'unconfirmed',
      field,
      statement: `${field} was extracted but not confirmed. ${f.needs_confirmation_because}`,
      next_action:
        f.source.audio_span !== undefined
          ? `Listen to the call span and accept or correct ${field}.`
          : `Compare the crop against the transcription and accept or correct ${field}.`,
    }
  }
  return { ok: true, fact: f }
}
