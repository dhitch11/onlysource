import type { Metadata } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { systemClock } from '@/lib/time/clock'
import {
  ACQUISITION_CHANNELS,
  EMPTY_FACTS,
  MATERIAL_CONDITIONS,
  buildDocumentsView,
  type CapturedFacts,
} from '@/lib/compliance/deliverables/view-model'

export const metadata: Metadata = { title: 'Documents and POs · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * DOCUMENTS AND POs, screen 6 of the approved seven.
 *
 * THIS FILE IS A THIN RENDER AND IS MEANT TO STAY THIN. Every state, sentence, verdict and figure comes
 * from `buildDocumentsView`, which is pure and tested without a browser. Nothing here decides anything,
 * so when T8's components land this file swaps its elements for theirs and not one verdict changes.
 *
 * PRESENTATION IS DELIBERATELY BORROWED, NOT INVENTED. The conductor's fleet notice is that the approved
 * mockup is a design comp rather than production markup, and that T8 owns the component layer. So this
 * screen ships ZERO bespoke design tokens, no colours, no pixel values and no copy of the mockup's
 * markup. It uses the primitives T1 already published in `app/globals.css` and semantic HTML. It will
 * look plain until T8's components arrive, and that is the honest state of it rather than a private
 * design system competing with theirs.
 *
 * THE INFO AFFORDANCE IS A DETAILS ELEMENT, not a `title` attribute and not `cursor: help`, both of which
 * the design review named as defects. It is focusable, it opens on click and on Enter, and it carries the
 * fifth help field, what this does not do.
 *
 * WHY A GET FORM. There is no database yet, so there is no lot to read and nothing to persist into.
 * Rather than fake persistence or disable the generator, the operator's entries are the input: the form
 * submits by GET, this server component reads the parameters, and the pipeline runs server-side. It works
 * with JavaScript disabled, and it never implies a stored record exists. When T1's schema lands, the same
 * view model reads a row instead of a query string.
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

/** State to pill variant. The three states are the mockup's three, and the mapping lives here only. */
function statePill(state: string): string {
  if (state === 'ready_to_submit') return 'pill pill--ok'
  if (state === 'draft_awaiting_approval') return 'pill pill--attention'
  return 'pill pill--off'
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireGateSession('/')
  const p = await searchParams
  const facts = factsFrom(p)
  const view = buildDocumentsView(facts, new Date(systemClock.now()).toISOString())

  return (
    <div className="stack">
      <section className="stack--tight">
        <h1 className="h1">Documents and POs</h1>
        <p className="lede">
          Generated from the opportunity. The paperwork built before it is demanded.
        </p>
        <details>
          <summary>What this screen is</summary>
          <div className="stack--tight">
            <p>
              <b>What this is.</b> The deliverable generator. It builds the paperwork from fields that
              have already been captured, so a request that arrives with a clock on it becomes a lookup.
            </p>
            <p>
              <b>How to use it.</b> Enter what is known about the lot and the solicitation. Every
              deliverable reports its own state, and one that cannot be completed names the field it is
              missing instead of rendering a gap.
            </p>
            <p>
              <b>Why it matters.</b> Supporting documentation is due within 24 hours of a request on the
              surplus path and within 2 days on the part-numbered path. Miss it and the offer is not
              considered.
            </p>
            <p>
              <b>What this does not do.</b> It does not send anything, it does not decide a price, and no
              language model writes any part of an artifact. Every figure on a rendered document is a
              reference to a stored value, listed with its source underneath.
            </p>
          </div>
        </details>
      </section>

      {/* ---------------------------------------------------------------- deliverables */}
      <section className="stack--tight">
        <h2 className="h2">Deliverables</h2>

        {view.empty_state ? (
          <div className="banner banner--notice">
            <p>
              <b>{view.empty_state.title}</b>
            </p>
            <p>{view.empty_state.body}</p>
          </div>
        ) : (
          <div className="stack--tight">
            {view.deliverables.map((d) => (
              <article className="card" key={d.kind}>
                <div className="card__head">
                  <h3 className="card__title">{d.label}</h3>
                  <span className={statePill(d.state)}>{d.state_label}</span>
                </div>
                <div className="card__body">
                  <p className="mono muted">{d.subtitle}</p>
                  <p>{d.statement}</p>
                  <p className="hint">
                    <b>Next.</b> {d.next_action}
                  </p>
                  {d.missing.length > 0 && (
                    <ul className="bullets">
                      {d.missing.map((m) => (
                        <li key={m.ref}>
                          Missing <code className="mono">{m.ref}</code>, {m.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------------- classification */}
      {view.classification && (
        <section className="stack--tight">
          <h2 className="h2">Compliance classification</h2>
          <div className="rows">
            <div className="row">
              <span className="row__key">Path</span>
              <span className="row__val">
                <span className={view.classification.is_classified ? 'pill pill--ok' : 'pill pill--off'}>
                  {view.classification.path_label}
                </span>
              </span>
            </div>
            <div className="row">
              <span className="row__key">Material category</span>
              <span className="row__val mono">{view.classification.category}</span>
            </div>
            <div className="row">
              <span className="row__key">Provenance rung</span>
              <span className="row__val mono">
                {view.classification.provenance_rung === null
                  ? 'none satisfied'
                  : `rung ${view.classification.provenance_rung}`}
              </span>
            </div>
          </div>

          <ul className="bullets">
            {view.classification.reasons.map((r) => (
              <li key={r.code}>
                {r.statement} <span className="muted">Deciding field: {r.deciding_field}.</span>
              </li>
            ))}
          </ul>

          {view.classification.rung_gap && <p className="hint">{view.classification.rung_gap}</p>}

          <h3 className="card__title">What would change this</h3>
          <ul className="bullets">
            {view.classification.what_would_change_it.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>

          <p className="hint mono">Rules applied: {view.classification.rule_labels.join(' | ')}</p>

          {view.classification.blocked_facts.length > 0 && (
            <div className="banner banner--attention">
              <p>
                <b>Gates that could not run</b>
              </p>
              <ul className="bullets">
                {view.classification.blocked_facts.map((b) => (
                  <li key={b.field}>
                    {b.statement} <b>Next.</b> {b.next_action}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- pre-flight */}
      {view.preflight && (
        <section className="stack--tight">
          <h2 className="h2">Zero-rejection pre-flight</h2>
          <p>
            <span
              className={
                view.preflight.verdict === 'clear'
                  ? 'pill pill--ok'
                  : view.preflight.verdict === 'blocked'
                    ? 'pill pill--attention'
                    : 'pill pill--off'
              }
            >
              {view.preflight.verdict_label}
            </span>
          </p>
          {view.preflight.clear_statement && <p>{view.preflight.clear_statement}</p>}

          {view.preflight.findings.map((f, i) => (
            <article
              className={f.severity === 'blocking' ? 'banner banner--danger' : 'banner banner--attention'}
              key={`${f.check}-${i}`}
            >
              <p>
                <b>{f.severity === 'blocking' ? 'Blocking' : 'Cannot assess'}</b> · {f.check}
              </p>
              <p>{f.statement}</p>
              {f.quote !== null ? (
                <blockquote>
                  <p>{f.quote}</p>
                  <cite className="mono">{f.quote_attribution}</cite>
                </blockquote>
              ) : (
                <p className="hint">
                  The exact wording of {f.quote_attribution} is not verified in the primary source, so it
                  is described rather than quoted.
                </p>
              )}
              <p className="muted mono">Failing field: {f.failing_field}</p>
              {f.reroute && (
                <p className="hint">
                  <b>Instead.</b> {f.reroute}
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {/* ---------------------------------------------------------------- the artifact */}
      {view.artifacts.length > 0 && (
        <section className="stack--tight">
          <h2 className="h2">The artifacts, rendered</h2>
          <p className="lede">
            Each document below was assembled by this build just now. Every figure in it is a resolved
            reference to a stored value, listed underneath with its source.
          </p>
          {view.artifacts.map((a) => (
            <article className="card" key={a.kind}>
              <div className="card__head">
                <h3 className="card__title">{a.label}</h3>
                <span className={a.view.ok ? 'pill pill--ok' : 'pill pill--attention'}>
                  {a.view.ok ? 'Assembled' : 'Refused to render'}
                </span>
              </div>
              <div className="card__body">
                {a.view.ok ? (
                  <>
                    <pre className="mono">{a.view.body}</pre>
                    <div className="rows">
                      {a.view.provenance.map((f) => (
                        <div className="row" key={f.ref}>
                          <span className="row__key mono">{`{{${f.ref}}}`}</span>
                          <span className="row__val">
                            <span className="mono">{f.value}</span>{' '}
                            <span className="muted">{f.source}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <ul className="bullets">
                      {a.view.refusals.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <p>{a.view.explanation}</p>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {/* ---------------------------------------------------------------- the generator */}
      <section className="stack--tight">
        <h2 className="h2">Run a lot through the pipeline</h2>
        <p className="lede">
          This runs the real classifier, the real pre-flight and the real assembler. Nothing is stored,
          and nothing is sent.
        </p>

        <form method="get" className="stack--tight">
          <fieldset>
            <legend>The lot</legend>
            <div className="field">
              <label className="label" htmlFor="nsn">
                National stock number
              </label>
              <input className="input" id="nsn" name="nsn" defaultValue={facts.nsn} required />
              <p className="hint">Required. Everything else is optional, and absence is reported honestly.</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="cage">
                Approved source CAGE code
              </label>
              <input className="input" id="cage" name="cage" defaultValue={facts.cage} />
            </div>
            <div className="field">
              <label className="label" htmlFor="part_number">
                Part number
              </label>
              <input className="input" id="part_number" name="part_number" defaultValue={facts.part_number} />
            </div>
            <div className="field">
              <label className="label" htmlFor="qty">
                Quantity on hand
              </label>
              <input className="input" id="qty" name="qty" inputMode="numeric" defaultValue={facts.qty} />
            </div>
            <div className="field">
              <label className="label" htmlFor="material_condition">
                Material condition
              </label>
              <select
                className="input"
                id="material_condition"
                name="material_condition"
                defaultValue={facts.material_condition}
              >
                <option value="">not recorded</option>
                {MATERIAL_CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="acquisition_channel">
                Acquisition channel
              </label>
              <select
                className="input"
                id="acquisition_channel"
                name="acquisition_channel"
                defaultValue={facts.acquisition_channel}
              >
                <option value="">not recorded</option>
                {ACQUISITION_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          <fieldset>
            <legend>Provenance evidence on file</legend>
            <div className="field">
              <label className="label" htmlFor="package_markings_captured">
                <input
                  type="checkbox"
                  id="package_markings_captured"
                  name="package_markings_captured"
                  defaultChecked={facts.package_markings_captured}
                />{' '}
                Original package markings photographed
              </label>
              <p className="hint">
                Rung 3 needs all four markings, including the original contract number, which is the
                highest-value field on the label.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="original_contract_number">
                Original contract number from the label
              </label>
              <input
                className="input"
                id="original_contract_number"
                name="original_contract_number"
                defaultValue={facts.original_contract_number}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="form_1427_document_id">
                DLA Disposition Services Form 1427 document id
              </label>
              <input
                className="input"
                id="form_1427_document_id"
                name="form_1427_document_id"
                defaultValue={facts.form_1427_document_id}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="sale_solicitation_document_id">
                Sale solicitation document id
              </label>
              <input
                className="input"
                id="sale_solicitation_document_id"
                name="sale_solicitation_document_id"
                defaultValue={facts.sale_solicitation_document_id}
              />
              <p className="hint">Rung 1 needs both this and the Form 1427.</p>
            </div>
          </fieldset>

          <fieldset>
            <legend>The solicitation and the quote</legend>
            <div className="field">
              <label className="label" htmlFor="solicitation_number">
                Solicitation number
              </label>
              <input
                className="input"
                id="solicitation_number"
                name="solicitation_number"
                defaultValue={facts.solicitation_number}
              />
              <p className="hint">The pre-flight runs only when there is a solicitation to run it against.</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="type_character">
                Type character
              </label>
              <select
                className="input"
                id="type_character"
                name="type_character"
                defaultValue={facts.type_character}
              >
                <option value="">not delivered</option>
                <option value="T">T, one-time buy</option>
                <option value="U">U, AIDC</option>
              </select>
              <p className="hint">
                On a U-type buy, surplus is disqualified from automated award. On a T-type buy it is not.
                Leaving it undelivered makes the pre-flight say it cannot assess, never that it is clear.
              </p>
            </div>
            <div className="field">
              <label className="label" htmlFor="is_automated">
                <input
                  type="checkbox"
                  id="is_automated"
                  name="is_automated"
                  defaultChecked={facts.is_automated}
                />{' '}
                Automated solicitation
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="offering_alternate_product">
                <input
                  type="checkbox"
                  id="offering_alternate_product"
                  name="offering_alternate_product"
                  defaultChecked={facts.offering_alternate_product}
                />{' '}
                We are offering an alternate product
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="item_cites_qpl_or_qml">
                <input
                  type="checkbox"
                  id="item_cites_qpl_or_qml"
                  name="item_cites_qpl_or_qml"
                  defaultChecked={facts.item_cites_qpl_or_qml}
                />{' '}
                Item cites a QPL or QML
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="quoted_manufacturer_listed">
                <input
                  type="checkbox"
                  id="quoted_manufacturer_listed"
                  name="quoted_manufacturer_listed"
                  defaultChecked={facts.quoted_manufacturer_listed}
                />{' '}
                Quoted manufacturer is on that list
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="quote_carries_remark">
                <input
                  type="checkbox"
                  id="quote_carries_remark"
                  name="quote_carries_remark"
                  defaultChecked={facts.quote_carries_remark}
                />{' '}
                The quote carries a Remark
              </label>
              <p className="hint">A Remark is one of the nine exceptions that throws out an automated award.</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="higher_level_quality_answered_none">
                <input
                  type="checkbox"
                  id="higher_level_quality_answered_none"
                  name="higher_level_quality_answered_none"
                  defaultChecked={facts.higher_level_quality_answered_none}
                />{' '}
                Higher Level Quality answered None
              </label>
            </div>
            <div className="field">
              <label className="label" htmlFor="unit_price">
                Unit price quoted
              </label>
              <input
                className="input"
                id="unit_price"
                name="unit_price"
                inputMode="decimal"
                defaultValue={facts.unit_price}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="validity_days">
                Quote validity, days
              </label>
              <input
                className="input"
                id="validity_days"
                name="validity_days"
                inputMode="numeric"
                defaultValue={facts.validity_days}
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="supplier">
                Supplier, for a purchase order
              </label>
              <input className="input" id="supplier" name="supplier" defaultValue={facts.supplier} />
            </div>
          </fieldset>

          <p>
            <button className="button" type="submit">
              Run the pipeline
            </button>{' '}
            <a className="button button--quiet" href="/documents">
              Clear
            </a>
          </p>
        </form>
      </section>

      {/* ---------------------------------------------------------------- honesty panel */}
      <section className="stack--tight">
        <h2 className="h2">What this build cannot quote yet</h2>
        {view.quarantined_rules.length === 0 ? (
          <p>Every rule cited on this screen has been read in its primary source.</p>
        ) : (
          <ul className="bullets">
            {view.quarantined_rules.map((r) => (
              <li key={r.identifier}>
                <b className="mono">{r.identifier}</b>. {r.why}
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          The counter-offer memo is the only deliverable containing prose, in{' '}
          {view.counter_offer_memo_segment_count} segments, and that prose is written and signed by a
          person. No model writes any part of any artifact on this screen.
        </p>
      </section>
    </div>
  )
}
