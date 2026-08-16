/**
 * THE APPROVED OUTREACH TEMPLATES AND THE COMPOSE DRAFT.
 *
 * What this file pins, in the house refusal + positive-control style:
 *
 *   1. THE DIRECTION OF THE PITCH. Every draft is the operator's proven BUY-SIDE offer
 *      (market the dormant inventory or buy it), never "fill my live requirements", which is
 *      backwards for a book of award-dead firms.
 *   2. THE GREETING BELONGS TO THE ADDRESS. The measured defect was TO one person, greeting
 *      another by first name. bestRecipient can no longer produce that pair.
 *   3. EVIDENCE-STATE LINES. A clause renders only when its field is measured: no last-award
 *      month from a null date, no NSN line from an empty join, never padded.
 *   4. HOUSE LAW. No em dash anywhere in net-new copy, and the operator signs: nothing after
 *      "Thanks,".
 *   5. startOutreach finally has approved templates to resolve.
 */

import { describe, expect, it } from 'vitest'
import {
  BUY_SIDE_EMAIL_TEMPLATE_ID,
  CALL_CAPTURE_FIELDS,
  FOLLOW_UP_CALL_SCRIPT,
  FOLLOW_UP_CALL_TEMPLATE_ID,
  OUTREACH_TEMPLATES,
  bestRecipient,
  buySideEmailDraft,
  firstNameOf,
  monthYearOf,
  nsnFactLine,
  resolveOutreachTemplate,
} from '@/lib/sales/outreach-templates'

const contact = (over: Partial<{ name: string | null; email: string | null; verified: boolean }> = {}) => ({
  name: null as string | null,
  email: null as string | null,
  verified: false,
  ...over,
})

describe('bestRecipient: the greeting belongs to the person the address belongs to', () => {
  it('prefers a VERIFIED contact with both name and email', () => {
    const r = bestRecipient({
      email: 'info@axis.example',
      executive: 'Michael Criner',
      contacts: [
        contact({ name: 'Justin Ray', email: 'justin@axis.example', verified: false }),
        contact({ name: 'Dana Cole', email: 'dana@axis.example', verified: true }),
      ],
    })
    expect(r).toEqual({ email: 'dana@axis.example', name: 'Dana Cole' })
  })

  it('THE MEASURED DEFECT CANNOT RECUR: a company inbox no listed contact owns greets NOBODY, never the executive', () => {
    // The live capture was TO justin@axismfgcnc.com greeting "Hi Michael" (the executive).
    const r = bestRecipient({
      email: 'justin@axismfgcnc.example',
      executive: 'Michael Criner',
      contacts: [],
    })
    expect(r?.email).toBe('justin@axismfgcnc.example')
    expect(r?.name).toBeNull()
  })

  it('POSITIVE CONTROL: the company inbox DOES carry a name when a listed contact owns that exact address', () => {
    const r = bestRecipient({
      email: 'Justin@AxisMfgCnc.example',
      executive: 'Michael Criner',
      contacts: [contact({ name: 'Justin Ray', email: 'justin@axismfgcnc.example' })],
    })
    // The named contact wins outright here, and it IS the same person and address, so the
    // greeting and the To line agree: exactly the property the resolver exists to hold.
    expect(r).toEqual({ email: 'justin@axismfgcnc.example', name: 'Justin Ray' })
  })

  it('returns null when no channel exists at all, never an invented address', () => {
    expect(bestRecipient({ email: null, executive: 'Somebody', contacts: [contact({ name: 'X' })] })).toBeNull()
  })

  it('falls through to a nameless contact email when that is all the file holds', () => {
    const r = bestRecipient({ email: null, executive: null, contacts: [contact({ email: 'shop@x.example' })] })
    expect(r).toEqual({ email: 'shop@x.example', name: null })
  })
})

describe('monthYearOf: deterministic, no locale API', () => {
  it('renders an ISO date as Mon YYYY', () => {
    expect(monthYearOf('2021-11-09')).toBe('Nov 2021')
    expect(monthYearOf('2016-01-03')).toBe('Jan 2016')
  })
  it('REFUSES garbage with null, never a guess', () => {
    expect(monthYearOf('but federal code retired')).toBeNull()
    expect(monthYearOf(null)).toBeNull()
    expect(monthYearOf('2021-13-01')).toBeNull()
  })
})

describe('buySideEmailDraft: the proven pitch, grounded per row', () => {
  const full = () =>
    buySideEmailDraft({
      recipientFirstName: firstNameOf('Dana Cole'),
      company: 'SMYTH COUNTY MACHINE AND WELDING, INC.',
      cage: '0J6L4',
      lastAwardedAt: '2021-11-09',
      holdsInventory: 'U.S./Canada Manufacturer',
      nsnFacts: [{ nsn: '5306016610755', kind: 'awarded', liveRequirement: true }],
    })

  it('pitches the BUY side: market or buy the dormant inventory, the scrapman hook, the easy ask', () => {
    const { subject, body } = full()
    expect(subject).toBe('That old DLA inventory is just collecting dust')
    expect(body).toContain('scrapman')
    expect(body).toContain('market the components you have made for DLA')
    expect(body).toContain('buy your entire inventory outright')
    expect(body).toContain('A quick reply gets it moving')
    // The wrong direction is gone in both its measured phrasings.
    expect(body).not.toContain('live DLA requirements')
    expect(body).not.toContain('positioned to fill')
  })

  it('anchors on the row itself: greeting, company, CAGE, last award month', () => {
    const { body } = full()
    expect(body).toContain('Hi Dana,')
    expect(body).toContain('SMYTH COUNTY MACHINE AND WELDING, INC. made parts for DLA')
    expect(body).toContain('CAGE 0J6L4')
    expect(body).toContain('last recorded award Nov 2021')
  })

  it('names THEIR stock number with the open-requirement fact when the join measured one', () => {
    const { body } = full()
    expect(body).toContain('NSN 5306016610755')
    expect(body).toContain('open requirement for it right now')
  })

  it('REFUSES to pad: no NSN line from an empty join, no award month from a null date, no name for a null recipient', () => {
    const { body } = buySideEmailDraft({
      recipientFirstName: null,
      company: null,
      cage: '1ABC2',
      lastAwardedAt: null,
      holdsInventory: null,
      nsnFacts: [],
    })
    expect(body).toContain('Hi,')
    expect(body).not.toContain('NSN ')
    expect(body).not.toContain('last recorded award')
    expect(body).toContain('Your company made parts for DLA (CAGE 1ABC2)')
    // The non-manufacturer offer is the dual offer in first person.
    expect(body).toContain('I buy dormant DLA inventory outright')
  })

  it('the operator signs: the draft ends at "Thanks," with nothing after it', () => {
    const { body } = full()
    expect(body.trimEnd().endsWith('Thanks,')).toBe(true)
  })

  it('HOUSE LAW: no em dash anywhere in subject or body, in any variant', () => {
    for (const variant of [
      full(),
      buySideEmailDraft({
        recipientFirstName: null,
        company: null,
        cage: 'X',
        lastAwardedAt: null,
        holdsInventory: null,
        nsnFacts: [{ nsn: '1234567890123', kind: 'lists_stock', liveRequirement: false }],
      }),
    ]) {
      expect(variant.subject).not.toMatch(/—/)
      expect(variant.body).not.toMatch(/—/)
    }
  })

  it('nsnFactLine states exactly what the index measured, no more', () => {
    expect(nsnFactLine({ nsn: '1', kind: 'lists_stock', liveRequirement: false })).toBe(
      'Your CAGE lists stock for NSN 1.',
    )
    expect(nsnFactLine({ nsn: '1', kind: 'awarded', liveRequirement: true })).toContain(
      'recorded DLA award history',
    )
  })
})

describe('the approved templates: startOutreach finally has something it is allowed to send', () => {
  it('resolves both templates by id; an unknown id is null', () => {
    expect(resolveOutreachTemplate(BUY_SIDE_EMAIL_TEMPLATE_ID)?.channel).toBe('email')
    expect(resolveOutreachTemplate(FOLLOW_UP_CALL_TEMPLATE_ID)?.channel).toBe('call')
    expect(resolveOutreachTemplate('free_prose_v1')).toBeNull()
  })

  it('every template names deterministic slots and its provenance', () => {
    for (const t of OUTREACH_TEMPLATES) {
      expect(t.slots.length).toBeGreaterThan(0)
      expect(t.provenance.length).toBeGreaterThan(20)
    }
  })

  it('the call script carries the three discovery questions, the objection branches, and the six-field capture list', () => {
    const text = FOLLOW_UP_CALL_SCRIPT.map((s) => `${s.label} ${s.lines.join(' ')}`).join('\n')
    expect(text).toContain('Do you still have inventory from past defense contracts?')
    expect(text).toContain('considered monetizing')
    expect(text).toContain('help sell or purchase that inventory')
    expect(text).toContain('no longer have inventory')
    expect(text.toLowerCase()).toContain('not interested')
    expect(CALL_CAPTURE_FIELDS.map((f) => f.label)).toEqual([
      'Decision maker',
      'Email confirmed',
      'Has excess inventory',
      'Interested in selling',
      'Interested in consignment',
      'Wants meeting',
    ])
  })

  it('HOUSE LAW: no em dash in any template copy or script line', () => {
    const everything = [
      ...OUTREACH_TEMPLATES.map((t) => `${t.name} ${t.provenance}`),
      ...FOLLOW_UP_CALL_SCRIPT.flatMap((s) => [s.label, ...s.lines]),
      ...CALL_CAPTURE_FIELDS.map((f) => f.label),
    ].join('\n')
    expect(everything).not.toMatch(/—/)
  })
})
