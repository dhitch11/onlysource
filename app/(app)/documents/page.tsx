import type { Metadata } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import { Button } from '@/components/ui/Button'
import { ExplainButton } from '@/components/ui/ExplainButton'
import { Identifier } from '@/components/ui/Identifier'
import { StatusChip, type ChipTone } from '@/components/ui/StatusChip'
import { EmptyState, InsufficientData } from '@/components/ui/States'
import controls from '@/components/ui/controls.module.css'
import {
  ACQUISITION_CHANNELS,
  EMPTY_FACTS,
  MATERIAL_CONDITIONS,
  buildDocumentsView,
  type CapturedFacts,
} from '@/lib/compliance/deliverables/view-model'
import type { DeliverableState } from '@/lib/compliance/deliverables/artifacts'
import { PacketVault } from './PacketVault'
import s from './documents.module.css'

export const metadata: Metadata = { title: 'Documents and POs · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * DOCUMENTS AND POs, screen 6 of the approved seven, rendered on T8's component library.
 *
 * THIS FILE IS A THIN RENDER AND STAYS THIN. Every state, sentence and verdict comes from
 * `buildDocumentsView`, which is pure and tested without a browser. Nothing here decides anything.
 * The practical proof of that boundary: this re-render swapped the entire presentation layer and did
 * not change one verdict or one test.
 *
 * THE VOCABULARY IS T8's AND ONLY T8's. Status through <StatusChip>, empty through <EmptyState>,
 * absent facts through <InsufficientData>, identifiers through <Identifier>, actions through
 * <Button>, explanations through <ExplainButton> against help ids this lane wrote. Form controls use
 * T8's own `controls.module.css` classes rather than a second set of my own. My CSS module holds
 * layout only: no colour, no font size, no pixel spacing.
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

/** One text input, styled by T8's controls module. */
function Field(props: {
  name: string
  label: string
  value: string
  hint?: string
  required?: boolean
  inputMode?: 'numeric' | 'decimal'
}) {
  const id = `f-${props.name}`
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>
        {props.label}
      </label>
      <input
        className={controls.input}
        id={id}
        name={props.name}
        defaultValue={props.value}
        required={props.required ?? false}
        {...(props.inputMode ? { inputMode: props.inputMode } : {})}
      />
      {props.hint ? <p className={controls.hint}>{props.hint}</p> : null}
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
}) {
  const id = `f-${props.name}`
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor={id}>
        {props.label}
      </label>
      <select className={controls.input} id={id} name={props.name} defaultValue={props.value}>
        <option value="">{props.emptyLabel}</option>
        {props.options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {props.hint ? <p className={controls.hint}>{props.hint}</p> : null}
    </div>
  )
}

function Check(props: { name: string; label: string; checked: boolean; hint?: string }) {
  const id = `f-${props.name}`
  return (
    <div>
      <label className={s.check} htmlFor={id}>
        <input type="checkbox" id={id} name={props.name} defaultChecked={props.checked} />
        <span>{props.label}</span>
      </label>
      {props.hint ? <p className={s.hint}>{props.hint}</p> : null}
    </div>
  )
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireGateSession('/')
  const p = await searchParams
  const facts = factsFrom(p)
  const view = buildDocumentsView(facts, new Date(systemClock.now()).toISOString())

  return (
    <div className={s.wrap}>
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

      {/* ---------------------------------------------------------------- saved packets */}
      <section className={s.section}>
        <div className={s.docHead}>
          <h2 className={s.sectionTitle}>Saved packets</h2>
        </div>
        <PacketVault currentNsn={facts.nsn} />
      </section>

      {/* ---------------------------------------------------------------- deliverables */}
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

      {/* ---------------------------------------------------------------- classification */}
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

      {/* ---------------------------------------------------------------- pre-flight */}
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

      {/* ---------------------------------------------------------------- rendered artifacts */}
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

      {/* ---------------------------------------------------------------- the generator */}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Run a lot through the pipeline</h2>
        <p className={s.lede}>
          This runs the real classifier, the real pre-flight and the real assembler. Save the result to
          your packets above to keep it; nothing is sent.
        </p>

        <form className={s.form} method="get">
          <fieldset className={s.fieldset}>
            <legend className={s.legend}>The lot</legend>
            <div className={s.fieldGrid}>
              <Field
                name="nsn"
                label="National stock number"
                value={facts.nsn}
                required
                hint="Required. Everything else is optional, and absence is reported rather than assumed."
              />
              <Field name="cage" label="Approved source CAGE code" value={facts.cage} />
              <Field name="part_number" label="Part number" value={facts.part_number} />
              <Field name="qty" label="Quantity on hand" value={facts.qty} inputMode="numeric" />
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
              />
              <Choice
                name="type_character"
                label="Type character"
                value={facts.type_character}
                options={['T', 'U']}
                emptyLabel="not delivered"
                hint="On a U-type buy surplus is disqualified. Leaving it undelivered reports cannot assess, never clear."
              />
              <Field name="unit_price" label="Unit price quoted" value={facts.unit_price} inputMode="decimal" />
              <Field name="validity_days" label="Quote validity, days" value={facts.validity_days} inputMode="numeric" />
              <Field name="supplier" label="Supplier, for a purchase order" value={facts.supplier} />
              <Field name="counter_price" label="Our counter figure" value={facts.counter_price} inputMode="decimal" />
              <Field name="countered_price" label="Price being countered" value={facts.countered_price} inputMode="decimal" />
            </div>
            <div className={s.checks}>
              <Check name="is_automated" label="Automated solicitation" checked={facts.is_automated} />
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

      {/* ---------------------------------------------------------------- honesty panel */}
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
  )
}
