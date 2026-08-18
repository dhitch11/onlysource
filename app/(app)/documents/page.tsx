import type { Metadata } from 'next'
import { requireGateSession, readGateVerdict } from '@/lib/session/require-gate'
import { ANONYMOUS_SUBJECT } from '@/lib/session/pre-release-gate'
import { findAccountById } from '@/lib/auth/accounts'
import { buildIdentity } from '@/lib/build-identity'
import { systemClock } from '@/lib/time/clock'
import { Button } from '@/components/ui/Button'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { Identifier } from '@/components/ui/Identifier'
import { Provenance } from '@/components/ui/Provenance'
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip'
import { EmptyState, InsufficientData } from '@/components/ui/States'
import controls from '@/components/ui/controls.module.css'
import { DownloadFileButton, PrintButton } from '@/components/documents/DocumentActions'
import {
  ACQUISITION_CHANNELS,
  EMPTY_FACTS,
  MATERIAL_CONDITIONS,
  buildDocumentsView,
  type CapturedFacts,
} from '@/lib/compliance/deliverables/view-model'
import type { DeliverableKind, DeliverableState } from '@/lib/compliance/deliverables/artifacts'
import {
  NO_PREFILL,
  applyPrefill,
  buildPrefill,
  reconcileCarried,
  unconfirmedCarries,
  unconfirmedCarryBlockers,
  type PrefillableField,
  type ReconciledCarry,
} from '@/lib/compliance/deliverables/prefill'
import {
  composeArtifactFile,
  composePacketFile,
  type DocumentFileInput,
} from '@/lib/compliance/deliverables/document-file'
import {
  SAVED_STAMP_KEYS,
  documentFingerprint,
  readSavedStamp,
  verifyReproduction,
} from '@/lib/compliance/deliverables/saved-document'
import { parsePrefillRequest, readPipelineChoices, resolvePrefill } from './prefill-source'
import { PacketQueuePrint, PacketVault } from './PacketVault'
import s from './documents.module.css'

export const metadata: Metadata = { title: 'Documents and POs · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * DOCUMENTS AND POs, screen 6 of the approved seven, rendered on T8's component library.
 *
 * THIS FILE IS A THIN RENDER AND STAYS THIN. Every state, sentence and verdict comes from
 * `buildDocumentsView`, `buildPrefill` and `composePacketFile`, all pure and all tested without a
 * browser. Nothing here decides anything. The practical proof of that boundary: this re-render swapped
 * the entire presentation layer and did not change one verdict or one test.
 *
 * THE VOCABULARY IS T8's AND ONLY T8's. Status through <StatusChip>, empty through <EmptyState>,
 * absent facts through <InsufficientData>, identifiers through <Identifier>, provenance through
 * <Provenance>, actions through <Button>, explanations through <ExplainButton> against help ids this
 * lane wrote. Form controls use T8's own `controls.module.css` classes rather than a second set of my
 * own. My CSS module holds layout only: no colour, no font size, no pixel spacing.
 *
 * TONE MAPPING, and why amber and red appear nowhere on this screen. T8 reserves amber and red for
 * auto-award clock urgency, so a red anywhere else is a bug. A blocked packet is therefore NOT red.
 * `ready_to_submit` maps to `verified` because it is a real, in-hand, assembled artifact, which is
 * exactly the measured role olive carries. `draft_awaiting_approval` maps to `active`, because it is
 * in progress and waiting on a person. `generate_from_blueprint` maps to `idle`, because nothing
 * exists yet. The severity of a blocker is carried by its words, which is also what stops a fact
 * from being encoded in hue alone.
 *
 * WHY THE FORM SUBMITS BY GET. There is no database yet, so there is nothing to persist a captured
 * lot into and nothing to read one back from. Rather than fake persistence or disable the generator,
 * the operator's entries ARE the input: the form submits by GET, this server component reads the
 * parameters, and the whole pipeline runs server-side. It works with JavaScript disabled and it never
 * implies a stored record exists. When T1's schema lands the same view model reads a row instead.
 *
 * =====================================================================================================
 * WHAT CHANGED, AND THE FINDING THAT DROVE IT.
 * =====================================================================================================
 * A money-journey audit of Find, Decide, Pursue, Quote and Close found the compliance machinery behind
 * this screen genuinely correct and the screen itself unusable as a deliverable:
 *
 *   EVERY INPUT WAS TYPED BY HAND. Nothing pre-filled from the corner just pursued, so the operator
 *   retyped the stock number, the CAGE, the quantity and the price they had already decided elsewhere.
 *   Retyping is where a digit gets dropped, and a wrong digit in a federal deliverable is a false
 *   representation with a signature under it. Now: arrive from a pipeline deal or a corner dossier and
 *   the measured values are already here, each one labelled with exactly where it came from, each one
 *   editable, and a carried PRICE holds the deliverables that cite it at DRAFT until a person acts.
 *
 *   THERE WAS NO FILE. The artifact was a <pre> block on a screen. Now it downloads and it prints, and
 *   both carry the feed day, the source archive, its digest and every abstention the screen showed,
 *   because a downloaded artifact that has shed its caveats is worse than no download: it gets
 *   forwarded.
 *
 *   A SAVED PACKET WAS A QUERY STRING. Reopening one silently regenerated against today's world and
 *   presented the result as the saved document. Now a saved packet carries a fingerprint of the
 *   document, and reopening it either says "this is the saved document, reproduced, inputs as of X" or
 *   says loudly that it is not.
 *
 * THE ONE THING DELIBERATELY NOT BUILT HERE: a DIBBS batch quote file. `lib/filing/**` already writes
 * one and is structurally incapable of submitting it. It is another lane's module and is not imported.
 * See the note above the download bar for exactly where it plugs in.
 */

type Params = Record<string, string | string[] | undefined>

function text(p: Params, k: string): string {
  const v = p[k]
  return typeof v === 'string' ? v.trim() : ''
}

function flag(p: Params, k: string): boolean {
  return text(p, k) === 'on'
}

function factsFrom(p: Params): CapturedFacts {
  return {
    ...EMPTY_FACTS,
    nsn: text(p, 'nsn'),
    cage: text(p, 'cage'),
    part_number: text(p, 'part_number'),
    qty: text(p, 'qty'),
    unit_price: text(p, 'unit_price'),
    validity_days: text(p, 'validity_days'),
    supplier: text(p, 'supplier'),
    solicitation_number: text(p, 'solicitation_number'),
    countered_price: text(p, 'countered_price'),
    counter_price: text(p, 'counter_price'),
    original_contract_number: text(p, 'original_contract_number'),
    form_1427_document_id: text(p, 'form_1427_document_id'),
    sale_solicitation_document_id: text(p, 'sale_solicitation_document_id'),
    material_condition: text(p, 'material_condition'),
    acquisition_channel: text(p, 'acquisition_channel'),
    type_character: text(p, 'type_character'),
    package_markings_captured: flag(p, 'package_markings_captured'),
    is_automated: flag(p, 'is_automated'),
    offering_alternate_product: flag(p, 'offering_alternate_product'),
    item_cites_qpl_or_qml: flag(p, 'item_cites_qpl_or_qml'),
    quoted_manufacturer_listed: flag(p, 'quoted_manufacturer_listed'),
    quote_carries_remark: flag(p, 'quote_carries_remark'),
    higher_level_quality_answered_none: flag(p, 'higher_level_quality_answered_none'),
  }
}

/** Deliverable state to T8's chip tone. See the tone-mapping note in the header. */
const STATE_TONE: Readonly<Record<DeliverableState, ChipTone>> = {
  ready_to_submit: 'verified',
  draft_awaiting_approval: 'active',
  generate_from_blueprint: 'idle',
}

/** How a carried field's current status reads, in three words the operator can act on. */
const CARRY_CHIP: Readonly<Record<ReconciledCarry['status'], string>> = {
  unchanged: 'Carried in',
  edited: 'You changed this',
  cleared: 'You cleared this',
}

const CARRY_TONE: Readonly<Record<ReconciledCarry['status'], ChipTone>> = {
  unchanged: 'accent',
  edited: 'idle',
  cleared: 'idle',
}

/**
 * The provenance marker under a carried field.
 *
 * IT IS NOT A DECORATION AND IT IS NOT OPTIONAL. A value sitting in an input box is indistinguishable
 * from one a person typed and checked, so a prefilled field without this block is an unlabelled claim.
 * The status chip states whether the operator has since touched it, because a screen that keeps calling
 * an edited value "carried from the award export" is worse than one that never labelled it: the label
 * makes the wrong attribution credible.
 */
function CarryMark({ carry }: { carry: ReconciledCarry }) {
  return (
    <div className={s.carry} data-carried={carry.status}>
      <div className={s.carryHead}>
        <Provenance kind={carry.provenance === 'measured' ? 'measured' : 'modelled'} showLabel />
        <StatusChip tone={CARRY_TONE[carry.status]}>{CARRY_CHIP[carry.status]}</StatusChip>
      </div>
      <p className={s.carryOrigin}>{carry.origin}</p>
      {carry.status !== 'unchanged' ? (
        <p className={s.carryOrigin}>
          <strong>That sentence describes the carried value, not what is in the box now.</strong> The
          value carried in was <span className={s.mono}>{carry.carried_value}</span>.
        </p>
      ) : null}
    </div>
  )
}

/** One text input, styled by T8's controls module. */
function Field(props: {
  name: string
  label: string
  value: string
  hint?: string
  required?: boolean
  inputMode?: 'numeric' | 'decimal'
  carry?: ReconciledCarry | undefined
}) {
  const id = `f-${props.name}`
  const carried = props.carry !== undefined && props.carry.status === 'unchanged'
  return (
    <div className={controls.field} data-field={props.name}>
      <label className={controls.label} htmlFor={id}>
        {props.label}
      </label>
      <input
        className={`${controls.input} ${carried ? s.inputCarried : ''}`}
        id={id}
        name={props.name}
        defaultValue={props.value}
        required={props.required ?? false}
        {...(props.inputMode ? { inputMode: props.inputMode } : {})}
      />
      {props.hint ? <p className={controls.hint}>{props.hint}</p> : null}
      {props.carry ? <CarryMark carry={props.carry} /> : null}
    </div>
  )
}

function Choice(props: {
  name: string
  label: string
  value: string
  options: readonly string[]
  emptyLabel: string
  hint?: string
  carry?: ReconciledCarry | undefined
}) {
  const id = `f-${props.name}`
  const carried = props.carry !== undefined && props.carry.status === 'unchanged'
  return (
    <div className={controls.field} data-field={props.name}>
      <label className={controls.label} htmlFor={id}>
        {props.label}
      </label>
      <select
        className={`${controls.input} ${carried ? s.inputCarried : ''}`}
        id={id}
        name={props.name}
        defaultValue={props.value}
      >
        <option value="">{props.emptyLabel}</option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {props.hint ? <p className={controls.hint}>{props.hint}</p> : null}
      {props.carry ? <CarryMark carry={props.carry} /> : null}
    </div>
  )
}

function Check(props: {
  name: string
  label: string
  checked: boolean
  hint?: string
  carry?: ReconciledCarry | undefined
}) {
  const id = `f-${props.name}`
  return (
    <div data-field={props.name}>
      <label className={s.check} htmlFor={id}>
        <input type="checkbox" id={id} name={props.name} defaultChecked={props.checked} />
        <span>{props.label}</span>
      </label>
      {props.hint ? <p className={s.hint}>{props.hint}</p> : null}
      {props.carry ? <CarryMark carry={props.carry} /> : null}
    </div>
  )
}

/** The provenance strip that heads every printed page. Same facts as the downloaded file's strip. */
function PrintStrip(props: {
  nsn: string
  generatedAt: string
  feedLine: string
  fingerprint: string
}) {
  return (
    <div className={s.printStrip}>
      <span>
        <strong>ONLYSOURCE</strong> working document, not a submission
      </span>
      <span className={s.mono}>NSN {props.nsn === '' ? 'not captured' : props.nsn}</span>
      <span>{props.feedLine}</span>
      <span className={s.mono}>generated {props.generatedAt}</span>
      <span className={s.mono}>fingerprint {props.fingerprint}</span>
    </div>
  )
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireGateSession('/')
  const p = await searchParams
  const asOf = new Date(systemClock.now()).toISOString()

  /*
   * WHO IS SIGNED IN, read from the session rather than assumed, because the downloaded file names
   * its operator and a forwarded file naming the wrong person is a fabricated attribution.
   */
  const verdict = await readGateVerdict()
  const account =
    verdict.valid && verdict.payload.sub !== ANONYMOUS_SUBJECT ? findAccountById(verdict.payload.sub) : null

  /*
   * THE PREFILL. Resolved on every render rather than once on arrival, and that is deliberate: the
   * carried set has to be rebuilt to be compared against what actually came back from the form, or the
   * screen would go on calling an edited field "carried from the award export".
   */
  const request = parsePrefillRequest(text(p, 'from'))
  const resolution = resolvePrefill(request)
  const prefill = resolution.evidence === null ? NO_PREFILL : buildPrefill(resolution.evidence)

  /*
   * THE MERGE RULE, in one line, and it is the whole reason a hidden `ran` field exists. On ARRIVAL
   * the URL carries no captured fields, so the carried values fill the form. After the operator presses
   * Run the pipeline the URL carries every field explicitly, including the ones they emptied on
   * purpose, so what came back WINS and nothing is re-applied over it. Re-applying would make an
   * emptied field refill itself, which is a form fighting its user.
   */
  const submitted = text(p, 'ran') === '1'
  const typed = factsFrom(p)
  const facts = submitted ? typed : applyPrefill(typed, prefill)

  const carried = reconcileCarried(prefill, facts)
  const carryByField = new Map<PrefillableField, ReconciledCarry>(carried.map((c) => [c.field, c]))
  const confirmed = flag(p, 'carried_confirmed')
  const pendingConfirmation = unconfirmedCarries(carried, confirmed)
  const view = buildDocumentsView(facts, asOf, unconfirmedCarryBlockers(carried, confirmed))

  const fingerprint = documentFingerprint(view)
  const stamp = readSavedStamp((k) => text(p, k))
  const reproduction = verifyReproduction(stamp, {
    fingerprint,
    feed_day: resolution.feed.known ? resolution.feed.feed_day : null,
    archive_sha256: resolution.feed.known ? resolution.feed.archive_sha256 : null,
  })

  const fileInput: DocumentFileInput = {
    generated_at: asOf,
    build_commit: buildIdentity().commit,
    feed: resolution.feed,
    view,
    carried,
    reproduction,
    operator: account === null ? null : account.name,
  }
  const packetFile = composePacketFile(fileInput)
  const artifactFiles = view.artifacts
    .filter((a) => a.view.ok)
    .map((a) => ({ kind: a.kind as DeliverableKind, label: a.label, file: composeArtifactFile(a.kind, fileInput) }))

  const feedLine = resolution.feed.known
    ? `feed day ${resolution.feed.feed_day}, archive ${resolution.feed.archive_key}`
    : 'no government feed day is being served in this environment'

  const pipeline = readPipelineChoices()
  const from = text(p, 'from')

  /*
   * THE CARRIED MARKER FOR PAPER. Added by review 2026-08-18.
   *
   * On screen a carried value is unmistakable: <CarryMark> sits directly under the input and states
   * its provenance, its status and its origin. On paper there is no input, and the requirement
   * sheet's facts grid was rendering "Unit price quoted" as a bare number, at exactly the same
   * confidence as a figure a person typed and checked, while the sentence disclosing that it is the
   * last price the government paid sat several inches lower on the sheet.
   *
   * That is the field-level version of the shed-caveat failure this lane exists to prevent, so the
   * marker rides in the value itself. It can only ever ADD a caveat: there is no value of the
   * argument that removes one.
   */
  function paperMark(field: PrefillableField): string {
    const c = carryByField.get(field)
    if (c === undefined || c.status !== 'unchanged') return ''
    return c.needs_confirmation ? ' (carried in, not confirmed by a person)' : ' (carried in)'
  }

  return (
    <div className={s.wrap} data-print="root">
      {/* ============================================================== the screen ============= */}
      <div className={s.screen} data-print="screen">
        <section className={s.section}>
          <div className={s.docHead}>
            <h1 className={s.sectionTitle}>Documents and POs</h1>
            <ExplainButton helpId="packet.state" />
          </div>
          <p className={s.lede}>
            Generated from the opportunity. The paperwork built before it is demanded, so a request
            that arrives with a clock on it is a lookup rather than a scramble.
          </p>
        </section>

        {/* ------------------------------------------------------------ the as-of notice */}
        {reproduction.kind !== 'not_a_reproduction' ? (
          <section className={s.section}>
            <div
              className={
                reproduction.kind === 'faithful' ? 'banner banner--attention' : 'banner banner--danger'
              }
              role={reproduction.kind === 'faithful' ? 'status' : 'alert'}
            >
              <strong>{reproduction.headline}</strong> {reproduction.detail}
              {reproduction.kind === 'drifted' ? (
                <ul className={s.reasons}>
                  {reproduction.differences.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ------------------------------------------------------------ where this came from */}
        <section className={s.section}>
          <div className={s.docHead}>
            <h2 className={s.sectionTitle}>Start from work you have already done</h2>
          </div>

          {resolution.problem !== null ? (
            <p className="banner banner--danger" role="alert">
              {resolution.problem}
            </p>
          ) : null}

          {prefill.carried.length > 0 ? (
            <>
              <p className={s.lede}>
                Filled from <strong>{prefill.source_label}</strong>. Every value below is a measured
                record, not a guess, and every one of them is yours to change. The sentence under each
                field says exactly what the value is.
              </p>
              <ul className={s.carryList}>
                {carried.map((c) => (
                  <li key={c.field} className={s.carryItem} data-carried={c.status}>
                    <div className={s.docHead}>
                      <Provenance kind={c.provenance === 'measured' ? 'measured' : 'modelled'} showLabel />
                      <span className={s.carryWhat}>{c.what}</span>
                      <StatusChip tone={CARRY_TONE[c.status]}>{CARRY_CHIP[c.status]}</StatusChip>
                      <span className={s.mono}>
                        {c.current_value === '' ? 'empty' : c.current_value}
                      </span>
                    </div>
                    <p className={s.carryOrigin}>{c.statement}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={s.lede}>
              Nothing has been carried in. Open a pipeline deal below, or arrive from a corner dossier,
              and the stock number, the solicitation, the approved source, the quantity and the last
              measured award price arrive with you.
            </p>
          )}

          {prefill.abstentions.length > 0 ? (
            <>
              <h3 className={s.docTitle}>What was deliberately not filled in</h3>
              <ul className={s.reasons}>
                {prefill.abstentions.map((a) => (
                  <li key={a.field}>
                    <span className={s.mono}>{a.field}</span>. {a.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {prefill.notes.length > 0 ? (
            <ul className={s.reasons}>
              {prefill.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}

          <h3 className={s.docTitle}>Your pipeline</h3>
          {!pipeline.ok ? (
            <InsufficientData missing={pipeline.why} />
          ) : pipeline.deals.length === 0 ? (
            <p className={s.hint}>
              No deals are in your pipeline yet. Pursue a corner from the Monopoly Map and it appears
              here, ready to build paperwork from.
            </p>
          ) : (
            <ul className={s.pipeList}>
              {pipeline.deals.slice(0, 12).map((d) => (
                <li key={d.id} className={s.pipeItem}>
                  <a className={s.pipeLink} href={`/documents?from=deal:${encodeURIComponent(d.id)}`}>
                    {d.title}
                  </a>
                  <span className={`mono ${s.pipeRef}`}>{d.ref === '' ? 'no reference' : d.ref}</span>
                  <StatusChip tone="idle">{d.stage.replace(/_/g, ' ')}</StatusChip>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------------ saved packets */}
        <section className={s.section}>
          <div className={s.docHead}>
            <h2 className={s.sectionTitle}>Saved packets</h2>
          </div>
          <PacketVault
            currentNsn={facts.nsn}
            stamp={{
              [SAVED_STAMP_KEYS.asOf]: asOf,
              [SAVED_STAMP_KEYS.fingerprint]: fingerprint,
              [SAVED_STAMP_KEYS.feedDay]: resolution.feed.known ? resolution.feed.feed_day : '',
              [SAVED_STAMP_KEYS.archiveSha]: resolution.feed.known ? resolution.feed.archive_sha256 : '',
            }}
          />
        </section>

        {/* ------------------------------------------------------------ deliverables */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Deliverables</h2>

          {view.empty_state ? (
            <EmptyState title={view.empty_state.title} body={view.empty_state.body} />
          ) : (
            <ul className={s.docList}>
              {view.deliverables.map((d) => (
                <li className={s.doc} key={d.kind}>
                  <div className={s.docHead}>
                    <h3 className={s.docTitle}>{d.label}</h3>
                    <StatusChip tone={STATE_TONE[d.state]}>{d.state_label}</StatusChip>
                    <Identifier value={d.subtitle} field="nsnOrPart" label="Stock number" />
                  </div>
                  <p className={s.docStatement}>{d.statement}</p>
                  <p className={s.docNext}>
                    <strong>Next.</strong> {d.next_action}
                  </p>
                  {d.missing.length > 0 && (
                    <ul className={s.missing}>
                      {d.missing.map((m) => (
                        <li key={m.ref}>
                          Missing <span className={s.mono}>{m.ref}</span>, {m.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------------------------------------ take it with you */}
        {view.captured ? (
          <section className={s.section}>
            <div className={s.docHead}>
              <h2 className={s.sectionTitle}>Take it with you</h2>
              <ExplainButton helpId="compliance.figure_provenance" />
            </div>
            <p className={s.lede}>
              A buyer needs a file, not a screen. Both routes below carry the whole record with them:
              the feed day, the source archive and its digest, every figure with its source, and every
              abstention this page is showing. A downloaded artifact that has shed its caveats is worse
              than no download, because it gets forwarded.
            </p>
            {pendingConfirmation.length > 0 ? (
              <p className="banner banner--attention" role="status">
                {pendingConfirmation.length === 1
                  ? 'One figure on this lot was carried in from a measured record and no person has confirmed it. '
                  : `${pendingConfirmation.length} figures on this lot were carried in from measured records and no person has confirmed them. `}
                They are in the file, marked as unconfirmed, and every deliverable that cites one is
                held at draft.
              </p>
            ) : null}
            <div className={s.actionRow}>
              <DownloadFileButton
                label="Download the whole packet"
                variant="primary"
                filename={packetFile.filename}
                mediaType={packetFile.media_type}
                content={packetFile.content}
                description="Every deliverable, every artifact body, every figure with its source, and every abstention, in one plain-text file you can attach to an email."
              />
              <PrintButton
                label="Print"
                description="Letter paper. Page one is the requirement sheet with two inches of ruled space for notes, then one page per artifact, then the abstentions, then your saved queue. The provenance strip heads every page."
              />
            </div>
            {artifactFiles.length > 0 ? (
              <>
                <h3 className={s.docTitle}>Or one deliverable on its own</h3>
                <div className={s.actionRow}>
                  {artifactFiles.map((a) => (
                    <DownloadFileButton
                      key={a.kind}
                      label={`Download ${a.label.toLowerCase()}`}
                      filename={a.file.filename}
                      mediaType={a.file.media_type}
                      content={a.file.content}
                      description="Carries the same provenance and the same abstentions as the whole packet, because a single artifact is the one most likely to be forwarded alone."
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className={s.hint}>
                No artifact has assembled yet, so there is nothing to download on its own. The
                deliverable rows above name what each one is still waiting for.
              </p>
            )}
            {/*
             * WHERE THE DIBBS BATCH QUOTE FILE PLUGS IN, when that lane's module is released to this
             * one. `lib/filing/**` writes the 121-column file a person uploads to DIBBS themselves and
             * is structurally incapable of sending it. It becomes one more entry in this row: build the
             * row from the same captured facts, hand the serialized string to <DownloadFileButton />
             * with media type text/plain and the DLA filename convention. Nothing above this comment
             * changes, because the download path already takes finished bytes and only wraps them.
             */}
          </section>
        ) : null}

        {/* ------------------------------------------------------------ classification */}
        {view.classification && (
          <section className={s.section}>
            <div className={s.docHead}>
              <h2 className={s.sectionTitle}>Compliance classification</h2>
              <ExplainButton helpId="compliance.path" />
            </div>

            <div className={s.rows}>
              <span className={s.rowKey}>Path</span>
              <span className={s.rowVal}>
                <StatusChip tone={view.classification.is_classified ? 'verified' : 'idle'}>
                  {view.classification.path_label}
                </StatusChip>
              </span>

              <span className={s.rowKey}>Material category</span>
              <span className={`${s.rowVal} ${s.mono}`}>{view.classification.category}</span>

              <span className={s.rowKey}>
                Provenance rung <ExplainButton helpId="compliance.provenance_rung" size="sm" />
              </span>
              <span className={`${s.rowVal} ${s.mono}`}>
                {view.classification.provenance_rung === null
                  ? 'none satisfied'
                  : `rung ${view.classification.provenance_rung}`}
              </span>
            </div>

            <ul className={s.reasons}>
              {view.classification.reasons.map((r) => (
                <li key={r.code}>
                  {r.statement} <span className={s.field}>deciding field: {r.deciding_field}</span>
                </li>
              ))}
            </ul>

            {view.classification.rung_gap && <p className={s.docNext}>{view.classification.rung_gap}</p>}

            <h3 className={s.docTitle}>What would change this</h3>
            <ul className={s.reasons}>
              {view.classification.what_would_change_it.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>

            <p className={s.hint}>
              <span className={s.mono}>Rules applied: {view.classification.rule_labels.join(' | ')}</span>
            </p>

            {view.classification.blocked_facts.map((b) => (
              <InsufficientData key={b.field} missing={`${b.statement} ${b.next_action}`} />
            ))}
          </section>
        )}

        {/* ------------------------------------------------------------ pre-flight */}
        {view.preflight && (
          <section className={s.section}>
            <div className={s.docHead}>
              <h2 className={s.sectionTitle}>Zero-rejection pre-flight</h2>
              <StatusChip
                tone={
                  view.preflight.verdict === 'clear'
                    ? 'verified'
                    : view.preflight.verdict === 'blocked'
                      ? 'active'
                      : 'idle'
                }
              >
                {view.preflight.verdict_label}
              </StatusChip>
              <ExplainButton helpId="traceability.preflight" />
            </div>

            {view.preflight.clear_statement && <p className={s.lede}>{view.preflight.clear_statement}</p>}

            {view.preflight.findings.map((f, i) => (
              <article className={s.finding} key={`${f.check}-${i}`}>
                <p className={s.findingHead}>
                  {f.severity === 'blocking' ? 'Blocking' : 'Cannot assess'}
                  <span className={s.field}>{f.check}</span>
                </p>
                <p className={s.docStatement}>{f.statement}</p>
                {f.quote !== null ? (
                  <blockquote className={s.quote}>
                    <p className={s.quoteText}>{f.quote}</p>
                    <cite className={s.quoteCite}>{f.quote_attribution}</cite>
                  </blockquote>
                ) : (
                  <p className={s.hint}>
                    The exact wording of {f.quote_attribution} is not verified in the primary source, so
                    it is described rather than quoted.
                  </p>
                )}
                <p className={s.hint}>
                  <span className={s.mono}>failing field: {f.failing_field}</span>
                </p>
                {f.reroute && (
                  <p className={s.docNext}>
                    <strong>Instead.</strong> {f.reroute}
                  </p>
                )}
              </article>
            ))}
          </section>
        )}

        {/* ------------------------------------------------------------ rendered artifacts */}
        {view.artifacts.length > 0 && (
          <section className={s.section}>
            <div className={s.docHead}>
              <h2 className={s.sectionTitle}>The artifacts, rendered</h2>
              <ExplainButton helpId="compliance.figure_provenance" />
            </div>
            <p className={s.lede}>
              Each document below was assembled by this build just now. Every figure in it is a resolved
              reference to a stored value, listed underneath with its source.
            </p>

            {view.artifacts.map((a) => (
              <article className={s.doc} key={a.kind}>
                <div className={s.docHead}>
                  <h3 className={s.docTitle}>{a.label}</h3>
                  <StatusChip tone={a.view.ok ? 'verified' : 'idle'}>
                    {a.view.ok ? 'Assembled' : 'Refused to render'}
                  </StatusChip>
                </div>

                {a.view.ok ? (
                  <>
                    <pre className={s.artifact}>{a.view.body}</pre>
                    <div className={s.provTable}>
                      <span className={s.provHead}>Reference</span>
                      <span className={s.provHead}>Value</span>
                      <span className={s.provHead}>Source</span>
                      {a.view.provenance.map((f) => (
                        <div key={f.ref} style={{ display: 'contents' }}>
                          <span className={`${s.provCell} ${s.mono}`}>{`{{${f.ref}}}`}</span>
                          <span className={`${s.provCell} ${s.mono}`}>{f.value}</span>
                          <span className={s.provCell}>{f.source}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <ul className={s.reasons}>
                      {a.view.refusals.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <p className={s.docNext}>{a.view.explanation}</p>
                  </>
                )}
              </article>
            ))}
          </section>
        )}

        {/* ------------------------------------------------------------ the generator */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}>Run a lot through the pipeline</h2>
          <p className={s.lede}>
            This runs the real classifier, the real pre-flight and the real assembler. Save the result to
            your packets above to keep it; nothing is sent.
          </p>

          <form className={s.form} method="get">
            {/*
             * `ran` is what tells the next render that these values came back from a person rather than
             * from the prefill, so an emptied field stays empty. `from` rides along so the carried
             * sentences survive the round trip and can be compared against what was submitted.
             */}
            <input type="hidden" name="ran" value="1" />
            {from === '' ? null : <input type="hidden" name="from" value={from} />}

            <fieldset className={s.fieldset}>
              <legend className={s.legend}>The lot</legend>
              <div className={s.fieldGrid}>
                <Field
                  name="nsn"
                  label="National stock number"
                  value={facts.nsn}
                  required
                  hint="Required. Everything else is optional, and absence is reported rather than assumed."
                  carry={carryByField.get('nsn')}
                />
                <Field
                  name="cage"
                  label="Approved source CAGE code"
                  value={facts.cage}
                  carry={carryByField.get('cage')}
                />
                <Field
                  name="part_number"
                  label="Part number"
                  value={facts.part_number}
                  carry={carryByField.get('part_number')}
                />
                <Field
                  name="qty"
                  label="Quantity"
                  value={facts.qty}
                  inputMode="numeric"
                  hint="This one figure is the quantity quoted, the quantity ordered and the quantity your traceability evidence covers. Enter the quantity you are actually quoting."
                  carry={carryByField.get('qty')}
                />
                <Choice
                  name="material_condition"
                  label="Material condition"
                  value={facts.material_condition}
                  options={MATERIAL_CONDITIONS}
                  emptyLabel="not recorded"
                />
                <Choice
                  name="acquisition_channel"
                  label="Acquisition channel"
                  value={facts.acquisition_channel}
                  options={ACQUISITION_CHANNELS}
                  emptyLabel="not recorded"
                />
              </div>
            </fieldset>

            <fieldset className={s.fieldset}>
              <legend className={s.legend}>
                Provenance evidence on file
                <ExplainButton helpId="compliance.provenance_rung" size="sm" />
              </legend>
              <div className={s.fieldGrid}>
                <Field
                  name="original_contract_number"
                  label="Original contract number from the label"
                  value={facts.original_contract_number}
                  hint="The highest-value field on the label. Rung 3 needs it."
                />
                <Field
                  name="form_1427_document_id"
                  label="DLA Disposition Services Form 1427 id"
                  value={facts.form_1427_document_id}
                />
                <Field
                  name="sale_solicitation_document_id"
                  label="Sale solicitation id"
                  value={facts.sale_solicitation_document_id}
                  hint="Rung 1 needs both this and the Form 1427."
                />
              </div>
              <div className={s.checks}>
                <Check
                  name="package_markings_captured"
                  label="Original package markings photographed"
                  checked={facts.package_markings_captured}
                  hint="Rung 3 needs all four markings, including the original contract number."
                />
              </div>
            </fieldset>

            <fieldset className={s.fieldset}>
              <legend className={s.legend}>The solicitation and the quote</legend>
              <div className={s.fieldGrid}>
                <Field
                  name="solicitation_number"
                  label="Solicitation number"
                  value={facts.solicitation_number}
                  hint="The pre-flight runs only when there is a solicitation to run it against."
                  carry={carryByField.get('solicitation_number')}
                />
                <Choice
                  name="type_character"
                  label="Type character"
                  value={facts.type_character}
                  options={['T', 'U']}
                  emptyLabel="not delivered"
                  hint="On a U-type buy surplus is disqualified. Leaving it undelivered reports cannot assess, never clear."
                  carry={carryByField.get('type_character')}
                />
                <Field
                  name="unit_price"
                  label="Unit price quoted"
                  value={facts.unit_price}
                  inputMode="decimal"
                  carry={carryByField.get('unit_price')}
                />
                <Field name="validity_days" label="Quote validity, days" value={facts.validity_days} inputMode="numeric" />
                <Field name="supplier" label="Supplier, for a purchase order" value={facts.supplier} />
                <Field name="counter_price" label="Our counter figure" value={facts.counter_price} inputMode="decimal" />
                <Field name="countered_price" label="Price being countered" value={facts.countered_price} inputMode="decimal" />
              </div>
              <div className={s.checks}>
                <Check
                  name="is_automated"
                  label="Automated solicitation"
                  checked={facts.is_automated}
                  carry={carryByField.get('is_automated')}
                />
                <Check
                  name="offering_alternate_product"
                  label="We are offering an alternate product"
                  checked={facts.offering_alternate_product}
                />
                <Check name="item_cites_qpl_or_qml" label="Item cites a QPL or QML" checked={facts.item_cites_qpl_or_qml} />
                <Check
                  name="quoted_manufacturer_listed"
                  label="Quoted manufacturer is on that list"
                  checked={facts.quoted_manufacturer_listed}
                />
                <Check
                  name="quote_carries_remark"
                  label="The quote carries a Remark"
                  checked={facts.quote_carries_remark}
                  hint="One of the nine exceptions that throws out an automated award."
                />
                <Check
                  name="higher_level_quality_answered_none"
                  label="Higher Level Quality answered None"
                  checked={facts.higher_level_quality_answered_none}
                />
              </div>
            </fieldset>

            {/*
             * THE CONFIRMATION GATE. Rendered only when something is actually waiting on it, because a
             * checkbox that is always there gets ticked out of habit and then it is not a gate.
             */}
            {pendingConfirmation.length > 0 ? (
              <fieldset className={s.fieldset}>
                <legend className={s.legend}>Confirm the figures that were carried in</legend>
                <ul className={s.reasons}>
                  {pendingConfirmation.map((c) => (
                    <li key={c.field}>
                      <strong>{c.what}</strong>, <span className={s.mono}>{c.carried_value}</span>. {c.origin}
                    </li>
                  ))}
                </ul>
                <div className={s.checks}>
                  <Check
                    name="carried_confirmed"
                    label="I have read the figures above and they are the figures I am using."
                    checked={confirmed}
                    hint="Until this is ticked, or the figure is changed, every deliverable that cites one of them stays a draft. Changing the figure does the same job: an edited value is yours."
                  />
                </div>
              </fieldset>
            ) : null}

            <div className={s.actions}>
              <Button type="submit" variant="primary">
                Run the pipeline
              </Button>
              <a className={controls.link} href="/documents">
                Clear
              </a>
            </div>
          </form>
        </section>

        {/* ------------------------------------------------------------ honesty panel */}
        <section className={s.section}>
          <h2 className={s.sectionTitle}>What this build cannot quote yet</h2>
          {view.quarantined_rules.length === 0 ? (
            <p className={s.lede}>Every rule cited on this screen has been read in its primary source.</p>
          ) : (
            <ul className={s.reasons}>
              {view.quarantined_rules.map((r) => (
                <li key={r.identifier}>
                  <span className={s.mono}>{r.identifier}</span>. {r.why}
                </li>
              ))}
            </ul>
          )}
          <p className={s.hint}>
            The counter-offer memo is the only deliverable containing prose, in{' '}
            {view.counter_offer_memo_segment_count} segments, and that prose is written and signed by a
            person. No model writes any part of any artifact on this screen.
          </p>
        </section>
      </div>

      {/* ============================================================== the paper ============== */}
      {/*
       * THE PRINT SHEET. A separate, purpose-built rendering rather than the screen reflowed, for one
       * reason: what a person carries to a desk is not the same document as what they work in. It is
       * driven by the SAME view model, so it cannot disagree with the screen about a single verdict.
       *
       * It is display:none on screen, which also keeps it out of the accessibility tree, so nothing
       * here is announced twice.
       */}
      <div className={s.paper} data-print="sheet">
        {/* ---- page 1, the requirement sheet ---- */}
        <section className={s.page}>
          <PrintStrip nsn={facts.nsn} generatedAt={asOf} feedLine={feedLine} fingerprint={fingerprint} />
          <h1 className={s.paperTitle}>Requirement sheet</h1>
          <dl className={s.paperFacts}>
            <div>
              <dt>Stock number</dt>
              <dd className={s.mono}>
                {facts.nsn === '' ? 'not captured' : facts.nsn}
                {paperMark('nsn')}
              </dd>
            </div>
            <div>
              <dt>Solicitation</dt>
              <dd className={s.mono}>
                {facts.solicitation_number === '' ? 'not captured' : facts.solicitation_number}
                {paperMark('solicitation_number')}
              </dd>
            </div>
            <div>
              <dt>Approved source CAGE</dt>
              <dd className={s.mono}>
                {facts.cage === '' ? 'not captured' : facts.cage}
                {paperMark('cage')}
              </dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd className={s.mono}>
                {facts.qty === '' ? 'not captured' : facts.qty}
                {paperMark('qty')}
              </dd>
            </div>
            <div>
              <dt>Unit price quoted</dt>
              <dd className={s.mono}>
                {facts.unit_price === '' ? 'not captured' : facts.unit_price}
                {paperMark('unit_price')}
              </dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{account === null ? 'not recorded for this session' : account.name}</dd>
            </div>
          </dl>

          {reproduction.kind !== 'not_a_reproduction' ? (
            <p className={s.paperNotice}>
              <strong>{reproduction.headline}</strong> {reproduction.detail}
            </p>
          ) : null}

          <h2 className={s.paperHeading}>The four deliverables</h2>
          {view.deliverables.length === 0 ? (
            <p className={s.paperBody}>
              No lot is captured, so no deliverable has a state. Nothing stands in for one.
            </p>
          ) : (
            <ul className={s.paperList}>
              {view.deliverables.map((d) => (
                <li key={d.kind}>
                  <strong>{d.label}</strong>. {d.state_label}. {d.statement} Next: {d.next_action}
                  {d.missing.length > 0 ? (
                    <span> Missing: {d.missing.map((m) => m.label).join(', ')}.</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {view.preflight ? (
            <>
              <h2 className={s.paperHeading}>
                Zero-rejection pre-flight: {view.preflight.verdict_label}
              </h2>
              {view.preflight.clear_statement ? (
                <p className={s.paperBody}>{view.preflight.clear_statement}</p>
              ) : null}
              <ul className={s.paperList}>
                {view.preflight.findings.map((f, i) => (
                  <li key={`${f.check}-${i}`}>
                    <strong>{f.severity === 'blocking' ? 'Blocking' : 'Cannot assess'}</strong>, {f.check}.{' '}
                    {f.statement} Failing field: {f.failing_field}.
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={s.paperBody}>
              No solicitation number is captured, so the pre-flight did not run. That is an absence, not
              a pass.
            </p>
          )}

          {/*
           * ONE LINE HERE, THE FULL LIST ON ITS OWN PAGE, and that split is a measurement rather than a
           * taste call. The requirement sheet has to fit on ONE sheet of letter paper, and the harness
           * measured it at 1,033px against a 960px content box with the carried list inline: page one
           * was spilling onto page two and pushing the ruled notes area with it. Nothing is dropped;
           * the detail moved to its own page, which the sentence below names so a reader holding page
           * one knows to turn over.
           */}
          {carried.length > 0 ? (
            <p className={s.paperBody}>
              <strong>
                {carried.length === 1
                  ? 'One value on this lot was carried in from a measured record rather than typed.'
                  : `${carried.length} values on this lot were carried in from measured records rather than typed.`}
              </strong>{' '}
              Each one is listed with its source on the page headed &ldquo;Carried in rather than
              typed&rdquo;.
              {pendingConfirmation.length > 0
                ? ` ${pendingConfirmation.length === 1 ? 'One of them has' : `${pendingConfirmation.length} of them have`} not been confirmed by a person, and every deliverable citing one is held at draft.`
                : ''}
            </p>
          ) : null}

          {/*
           * TWO INCHES OF RULED WHITE SPACE, asked for by name by the war room's Principal User chair.
           * Six rules at exactly one third of an inch, which is 2in of writing space and not a pixel
           * more. Real borders rather than a background gradient, because most browsers print with
           * backgrounds off by default and a ruled area that prints blank is a design that shipped and
           * did nothing.
           */}
          <div className={s.notesBlock}>
            <p className={s.notesLabel}>Notes, and what the buyer said</p>
            <div className={s.notes}>
              <div className={s.notesRule} />
              <div className={s.notesRule} />
              <div className={s.notesRule} />
              <div className={s.notesRule} />
              <div className={s.notesRule} />
              <div className={s.notesRule} />
            </div>
          </div>
        </section>

        {/* ---- one page per assembled artifact ---- */}
        {view.artifacts.map((a) => (
          <section className={s.page} key={`paper-${a.kind}`}>
            <PrintStrip nsn={facts.nsn} generatedAt={asOf} feedLine={feedLine} fingerprint={fingerprint} />
            <h1 className={s.paperTitle}>{a.label}</h1>
            {a.view.ok ? (
              <>
                <pre className={s.paperArtifact}>{a.view.body}</pre>
                <h2 className={s.paperHeading}>Every figure above, and where it came from</h2>
                <ul className={s.paperList}>
                  {a.view.provenance.map((f) => (
                    <li key={f.ref}>
                      <span className={s.mono}>
                        {'{{'}
                        {f.ref}
                        {'}}'}
                      </span>{' '}
                      <span className={s.mono}>{f.value}</span>, {f.source}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className={s.paperBody}>
                  This artifact refused to render, so it is not printed. A federal document with a gap
                  where a figure belongs is not a draft, it is an artifact that must not exist.
                </p>
                <ul className={s.paperList}>
                  {a.view.refusals.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}

        {/* ---- carried values, in full ---- */}
        {carried.length > 0 ? (
          <section className={s.page}>
            <PrintStrip nsn={facts.nsn} generatedAt={asOf} feedLine={feedLine} fingerprint={fingerprint} />
            <h1 className={s.paperTitle}>Carried in rather than typed</h1>
            <p className={s.paperBody}>
              A carried value came from a measured record rather than from a person. Each one is named
              here with its source and whether the operator changed it.
            </p>
            <ul className={s.paperList}>
              {carried.map((c) => (
                <li key={c.field}>
                  {c.statement}
                  {c.needs_confirmation && c.status === 'unchanged'
                    ? ' This figure has not been confirmed by a person as the operator\u2019s own.'
                    : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* ---- the abstentions ---- */}
        <section className={s.page}>
          <PrintStrip nsn={facts.nsn} generatedAt={asOf} feedLine={feedLine} fingerprint={fingerprint} />
          <h1 className={s.paperTitle}>What this document does not say</h1>
          {view.classification ? (
            <>
              <h2 className={s.paperHeading}>Classification</h2>
              <p className={s.paperBody}>
                {view.classification.path_label}. Material category {view.classification.category}.
                Provenance{' '}
                {view.classification.provenance_rung === null
                  ? 'rung: none satisfied'
                  : `rung ${view.classification.provenance_rung}`}
                .
              </p>
              <ul className={s.paperList}>
                {view.classification.reasons.map((r) => (
                  <li key={r.code}>
                    {r.statement} Deciding field: {r.deciding_field}.
                  </li>
                ))}
                {view.classification.blocked_facts.map((b) => (
                  <li key={b.field}>
                    <strong>Unread fact, {b.field}.</strong> {b.statement} {b.next_action}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={s.paperBody}>No lot is captured, so nothing has been classified.</p>
          )}

          <h2 className={s.paperHeading}>Rules this build may not quote yet</h2>
          {view.quarantined_rules.length === 0 ? (
            <p className={s.paperBody}>
              Every rule cited on this document has been read in its primary source.
            </p>
          ) : (
            <ul className={s.paperList}>
              {view.quarantined_rules.map((r) => (
                <li key={r.identifier}>
                  {r.identifier}. {r.why}
                </li>
              ))}
            </ul>
          )}

          <p className={s.paperBody}>
            This is a working document produced by ONLYSOURCE. It is not a submission. Nothing in this
            product transmits anything to a government system.
          </p>
        </section>

        {/* ---- the day's queue, with the same provenance strip at its head ---- */}
        <PacketQueuePrint
          heading={
            <PrintStrip
              nsn={facts.nsn}
              generatedAt={asOf}
              feedLine={feedLine}
              fingerprint={fingerprint}
            />
          }
        />
      </div>
    </div>
  )
}
