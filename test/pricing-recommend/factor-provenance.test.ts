/**
 * A SENTENCE THAT DESCRIBES THE DATA MUST BE COMPUTED FROM THE DATA.
 *
 * This file exists because the rung 1 caveat shipped for one day reading "Neither factor names a
 * published series. They are the expert's stated judgements", hardcoded. On 2026-08-19 the data
 * lane identified the CPI factor as BLS series CUUR0000SA0 and wrote the id onto the config. From
 * that moment a hardcoded sentence would have been telling an operator the opposite of what the
 * configuration said, in the confident register of a caveat, on the surface where being able to
 * name the source is the entire reason the figure is defensible.
 *
 * The same fact drives the EVIDENCE GRADE, and that is not cosmetic either. A factor that names a
 * published series is a READING: it has a date, it goes stale, and refreshing it is a real action
 * an operator can take. A factor that names none is a JUDGEMENT: it cannot go stale because it was
 * never read, and no amount of re-reading will refresh it. Grading a reading PRIOR understates
 * what we hold. Grading a judgement MEASURED launders somebody's opinion into a government file.
 *
 * POSITIVE CONTROL, run by hand and recorded here: replacing `describeFactorProvenance` with the
 * old hardcoded sentence turns the first two tests red, and pinning `factorEvidenceState` to
 * 'PRIOR' turns the third red.
 */

import { describe, expect, it } from 'vitest'
import { INDEX_CONFIG_1650, type AnchorIndexConfig } from '@/lib/engine/pricing'
import { recommendPrice } from '@/lib/intelligence/pricing/recommend'
import { fullLadderInput } from './_fixtures'

/** The same config with a series id removed, so the judgement branch can be exercised. */
function withoutSeriesIds(base: AnchorIndexConfig): AnchorIndexConfig {
  const strip = (spec: AnchorIndexConfig['cpi']): AnchorIndexConfig['cpi'] => ({
    ...spec,
    vintage: { ...spec.vintage, publishedSeriesId: null },
  })
  return { cpi: strip(base.cpi), dodProcurement: strip(base.dodProcurement) }
}

/** The same config with a series id on both, so the reading branch can be exercised. */
function withSeriesIds(base: AnchorIndexConfig): AnchorIndexConfig {
  return {
    cpi: { ...base.cpi, vintage: { ...base.cpi.vintage, publishedSeriesId: 'CUUR0000SA0' } },
    dodProcurement: {
      ...base.dodProcurement,
      vintage: { ...base.dodProcurement.vintage, publishedSeriesId: 'TEST-DEFLATOR-01' },
    },
  }
}

function anchorRung(indices: AnchorIndexConfig) {
  const rec = recommendPrice(fullLadderInput({ indices }))
  const rung = rec.ladder.find((r) => r.rung === 'R1_MANUFACTURER_ANCHOR')
  if (rung?.resolved !== true) throw new Error('the anchor rung must resolve on this fixture')
  return rung
}

describe('the anchor rung describes its own factors rather than asserting a fixed story', () => {
  it('calls an unnamed factor a stated judgement', () => {
    const rung = anchorRung(withoutSeriesIds(INDEX_CONFIG_1650))
    const caveat = rung.caveats.find((c) => c.code === 'INFLATION_FACTORS_ARE_STATED_JUDGEMENTS')
    expect(caveat?.sentence).toContain('names no published series')
    expect(caveat?.sentence).toContain("expert's stated judgement")
    expect(caveat?.sentence).not.toContain('goes stale')
    // What would sharpen it is identifying a series, not re-reading one that does not exist.
    expect(rung.wouldSharpenWith.join(' ')).toContain('identifying a published series')
    expect(rung.wouldSharpenWith.join(' ')).not.toContain('re-reading series')
  })

  it('calls a NAMED factor a dated reading, and names the series', () => {
    const rung = anchorRung(withSeriesIds(INDEX_CONFIG_1650))
    const caveat = rung.caveats.find((c) => c.code === 'INFLATION_FACTORS_ARE_STATED_JUDGEMENTS')
    expect(caveat?.sentence).toContain('CUUR0000SA0')
    expect(caveat?.sentence).toContain('goes stale')
    expect(caveat?.sentence).not.toContain('names no published series')
    // A reading can be refreshed, and that is the action offered.
    expect(rung.wouldSharpenWith.join(' ')).toContain('re-reading series CUUR0000SA0')
    expect(rung.wouldSharpenWith.join(' ')).not.toContain('identifying a published series')
  })

  it('grades a reading MEASURED and a judgement PRIOR, on the input line itself', () => {
    const named = anchorRung(withSeriesIds(INDEX_CONFIG_1650))
    for (const input of named.inputs.filter((i) => i.label.endsWith('factor'))) {
      expect(input.evidenceState).toBe('MEASURED')
      expect(input.renderedValue).toContain('series ')
    }
    const unnamed = anchorRung(withoutSeriesIds(INDEX_CONFIG_1650))
    for (const input of unnamed.inputs.filter((i) => i.label.endsWith('factor'))) {
      expect(input.evidenceState).toBe('PRIOR')
      expect(input.renderedValue).not.toContain('series ')
    }
  })

  it('carries the vintage note unedited, because that is where the staleness lives', () => {
    const rung = anchorRung(INDEX_CONFIG_1650)
    const cpi = rung.inputs.find((i) => i.label === 'CPI factor')
    expect(cpi?.source).toBe(INDEX_CONFIG_1650.cpi.vintage.note)
  })

  it('the mixed case reads correctly, which is the live configuration today', () => {
    // CPI names CUUR0000SA0; the DoD procurement factor still names nothing. The sentence has to
    // say BOTH things about the SAME band without collapsing them into one claim.
    const mixed: AnchorIndexConfig = {
      cpi: withSeriesIds(INDEX_CONFIG_1650).cpi,
      dodProcurement: withoutSeriesIds(INDEX_CONFIG_1650).dodProcurement,
    }
    const rung = anchorRung(mixed)
    const caveat = rung.caveats.find((c) => c.code === 'INFLATION_FACTORS_ARE_STATED_JUDGEMENTS')
    expect(caveat?.sentence).toContain('CUUR0000SA0')
    expect(caveat?.sentence).toContain('names no published series')
    const joined = rung.wouldSharpenWith.join(' ')
    expect(joined).toContain('identifying a published series behind the DoD procurement factor')
    expect(joined).toContain('re-reading series CUUR0000SA0')
  })
})
