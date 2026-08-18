/**
 * SAVING THE DOCUMENT, NOT THE FORM.
 *
 * =====================================================================================================
 * THE DEFECT. A saved packet used to be a query string. Reopening it re-ran the classifier, the
 * pre-flight and the assembler against today's world and presented the result as the thing that was
 * saved. Every one of those inputs can move: the served feed day advances, the citation layer gets a
 * rule verified, a template changes. So the artifact on screen could differ from the artifact that was
 * saved, in a federal deliverable, with nothing on the page saying so. That is the silent-regeneration
 * failure, and it is worse than not saving at all because the operator believes they are looking at
 * the document they filed.
 *
 * =====================================================================================================
 * THE FIX, AND WHY IT IS A FINGERPRINT RATHER THAN A COPY.
 * =====================================================================================================
 * The artifact bodies are a pure function of the captured inputs, and the inputs travel in the saved
 * query in full. So the document IS reproducible byte for byte; what was missing was any way to KNOW
 * whether the reproduction matched. A fingerprint of the rendered document is taken at save time and
 * carried with the saved record. On reopen the same fingerprint is recomputed and compared:
 *
 *   MATCH      this is the saved document, reproduced. Say so, and say the inputs are as of the save.
 *   MISMATCH   this is NOT the saved document. Say that loudly, name both fingerprints, and refuse to
 *              call it a reproduction.
 *
 * A mismatch is not an error state to hide. It is the most useful thing this surface can tell an
 * operator holding a packet from three weeks ago.
 *
 * =====================================================================================================
 * WHAT THE FINGERPRINT IS, STATED HONESTLY. FNV-1a, 64 bit. IT IS A CHANGE DETECTOR AND NOT A
 * CRYPTOGRAPHIC HASH, and nothing in this build treats it as one. It is not a signature, it does not
 * authenticate anything, and an adversary who controls the saved record can forge it trivially. It
 * exists to answer one question honestly: did this document come out the same way twice.
 * =====================================================================================================
 *
 * No clock and no IO. The instant is passed in by the caller, and the saved stamp arrives as strings
 * off a query.
 */

import type { DocumentsView } from './view-model'

/** The 64-bit FNV-1a offset basis and prime. */
const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/**
 * FNV-1a over the UTF-8 code units of the string. Deterministic, dependency free, and identical on a
 * server and in a test runner, which is the whole requirement.
 */
export function fingerprintOf(text: string): string {
  let h = FNV_OFFSET
  const bytes = new TextEncoder().encode(text)
  for (const b of bytes) {
    h = (h ^ BigInt(b)) & MASK64
    h = (h * FNV_PRIME) & MASK64
  }
  return h.toString(16).padStart(16, '0')
}

/**
 * The canonical text a document's fingerprint is taken over.
 *
 * IT COVERS THE VERDICTS, NOT ONLY THE PROSE. A packet whose artifact bodies are identical but whose
 * quote packet moved from READY TO SUBMIT to DRAFT is a different document to the person holding it,
 * so the deliverable states, the classification path and the pre-flight verdict are all in the
 * fingerprint. It deliberately does NOT cover the render instant, which changes on every page view and
 * would make every reproduction report as drifted.
 */
export function canonicalDocumentText(view: DocumentsView): string {
  const lines: string[] = []
  lines.push(`captured=${view.captured ? '1' : '0'}`)
  for (const d of view.deliverables) {
    /*
     * THE STATEMENT IS IN THE FINGERPRINT, NOT ONLY THE STATE. Two different compliance blockers can
     * leave a deliverable in the same state while telling the operator two completely different things
     * about why. The person holding the packet read the sentence, so the sentence is part of the
     * document, and a reproduction that changed it changed the document.
     */
    lines.push(
      `deliverable\t${d.kind}\t${d.state}\t${d.subtitle}\t${d.missing.map((m) => m.ref).join(',')}\t` +
        `${d.statement}\t${d.next_action}`,
    )
  }
  if (view.classification !== null) {
    lines.push(
      `classification\t${view.classification.path_label}\t${view.classification.category}\t` +
        `${view.classification.provenance_rung === null ? 'none' : view.classification.provenance_rung}`,
    )
  }
  if (view.preflight !== null) {
    lines.push(`preflight\t${view.preflight.verdict}\t${view.preflight.findings.length}`)
    for (const f of view.preflight.findings) {
      lines.push(`finding\t${f.check}\t${f.severity}\t${f.failing_field}\t${f.statement}`)
    }
  }
  for (const a of view.artifacts) {
    lines.push(`artifact\t${a.kind}\t${a.view.ok ? 'ok' : 'refused'}`)
    lines.push(a.view.ok ? a.view.body : a.view.refusals.join('\n'))
  }
  return lines.join('\n')
}

export function documentFingerprint(view: DocumentsView): string {
  return fingerprintOf(canonicalDocumentText(view))
}

// ---------------------------------------------------------------------------------------------------
// THE SAVED STAMP
// ---------------------------------------------------------------------------------------------------

/**
 * The four parameters a saved packet carries in addition to its inputs. Underscore-prefixed so they
 * can never collide with a captured field, and read only by this module.
 */
export const SAVED_STAMP_KEYS = {
  asOf: '_asof',
  fingerprint: '_fp',
  feedDay: '_feed',
  archiveSha: '_arch',
} as const

export type SavedStamp = {
  readonly saved_as_of: string
  readonly fingerprint: string
  readonly feed_day: string
  readonly archive_sha256: string
}

/** Read the stamp off a query. Returns null when this is not a reproduction of a saved document. */
export function readSavedStamp(get: (key: string) => string): SavedStamp | null {
  const fingerprint = get(SAVED_STAMP_KEYS.fingerprint).trim()
  if (fingerprint === '') return null
  return {
    saved_as_of: get(SAVED_STAMP_KEYS.asOf).trim(),
    fingerprint,
    feed_day: get(SAVED_STAMP_KEYS.feedDay).trim(),
    archive_sha256: get(SAVED_STAMP_KEYS.archiveSha).trim(),
  }
}

export type ReproductionVerdict =
  | { readonly kind: 'not_a_reproduction' }
  | {
      readonly kind: 'faithful'
      readonly saved_as_of: string
      readonly headline: string
      readonly detail: string
    }
  | {
      readonly kind: 'drifted'
      readonly saved_as_of: string
      readonly headline: string
      readonly detail: string
      readonly differences: readonly string[]
    }

/**
 * Compare the saved stamp against what this render actually produced.
 *
 * THE DIRECTION OF FAILURE IS DELIBERATE. Anything other than an exact fingerprint match reports
 * DRIFTED. An unparseable stamp, a missing feed day, an empty saved instant: all of them land in
 * drifted with the reason named, because "we could not verify this is the saved document" and "this is
 * the saved document" must never render as the same sentence.
 */
export function verifyReproduction(
  stamp: SavedStamp | null,
  current: { readonly fingerprint: string; readonly feed_day: string | null; readonly archive_sha256: string | null },
): ReproductionVerdict {
  if (stamp === null) return { kind: 'not_a_reproduction' }

  const differences: string[] = []
  if (stamp.fingerprint !== current.fingerprint) {
    differences.push(
      `The document does not come out the same way. Saved fingerprint ${stamp.fingerprint}, this ` +
        `render ${current.fingerprint}.`,
    )
  }
  if (stamp.feed_day !== '' && current.feed_day !== null && stamp.feed_day !== current.feed_day) {
    differences.push(
      `The workspace was serving government feed day ${stamp.feed_day} when this was saved and is ` +
        `serving ${current.feed_day} now.`,
    )
  }
  if (stamp.feed_day !== '' && current.feed_day === null) {
    differences.push(
      `The workspace was serving government feed day ${stamp.feed_day} when this was saved. The feed ` +
        'day cannot be read in this environment, so the two cannot be compared.',
    )
  }
  if (
    stamp.archive_sha256 !== '' &&
    current.archive_sha256 !== null &&
    stamp.archive_sha256 !== current.archive_sha256
  ) {
    differences.push(
      'The source archive behind the feed has changed since this was saved. Saved archive digest ' +
        `${stamp.archive_sha256}, current ${current.archive_sha256}.`,
    )
  }
  if (stamp.saved_as_of === '') {
    differences.push('The saved record carries no save instant, so it cannot say how old these inputs are.')
  }

  const savedAs = stamp.saved_as_of === '' ? 'an instant this record did not keep' : stamp.saved_as_of

  if (differences.length === 0) {
    return {
      kind: 'faithful',
      saved_as_of: stamp.saved_as_of,
      headline: 'This is the saved document, reproduced from the inputs that were saved with it.',
      detail:
        `The inputs are AS OF ${savedAs} and nothing about them has been re-read since. The world may ` +
        'have moved: a solicitation can close, an award can land, a source can be added. Check the ' +
        'solicitation before you submit anything built from this.',
    }
  }

  return {
    kind: 'drifted',
    saved_as_of: stamp.saved_as_of,
    headline: 'This is NOT the document that was saved. It has been regenerated and it came out different.',
    detail:
      `The inputs are AS OF ${savedAs}. What is on this screen was built now, from those inputs, and it ` +
      'does not match what was saved. Treat it as a fresh generation and read it again before you use ' +
      'it. The differences are listed below.',
    differences,
  }
}
