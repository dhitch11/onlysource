import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/*
 * ==========================================================================================
 * THE GATE, BECAUSE CARE DOES NOT TRAVEL AND A COMMENT IS NOT A CONTROL.
 * ==========================================================================================
 * `priceScaleSuspect` marks an award series whose unit price jumps by an exact power of ten
 * inside one contract. Any code that reads `firstUnitPrice` or `lastUnitPrice` is holding the two
 * endpoints of that series, and the natural thing to do with two endpoints is state a trend.
 *
 * SIX SITES DID, and they were found one at a time, each after the previous "fix" was believed
 * complete: the portfolio leaderboard, the dossier, the CornerScore trend leg, the exhibit prose,
 * the Thomas concierge, and the FSC peer pool that carried it to a whole supply class. The
 * seventh will be written by someone who has never read any of this.
 *
 * So the allow-list below is the control. Adding a reader of these fields fails this test until
 * the author puts the file in the list, which is the moment they have to answer: what does this
 * say when the series cannot be trusted?
 */
const REVIEWED: Record<string, string> = {
  'lib/intelligence/awards/nsn-now.ts': 'the source: computes the endpoints and the suspicion itself',
  'lib/intelligence/portfolio.ts': 'escalationPct abstains; suspect drops out of escalationLeaders',
  'lib/intelligence/brief/dossier.ts': 'escalationPct abstains; carries priceScaleNote downstream',
  'lib/intelligence/brief/package.ts': 'prints a "Price scale:" line in the exhibit',
  'lib/thomas/tools.ts': 'told to the model explicitly, with an instruction not to narrate a trend',
  'lib/intelligence/scoring/cornerscore.ts': 'trend leg scores 0 and says why',
  'lib/intelligence/monopoly-view.ts': 'passes the endpoints through; rising flag comes from isRisingPrice',
  'lib/intelligence/rising-price.ts': 'the shared predicate, called with endpoints by its consumers',
  'app/(app)/corner/[nsn]/page.tsx':
    'Change renders as a dash and a note underneath says why, so the dash is never read as zero',
  'app/(app)/monopoly/MonopolyGrid.tsx': 'renders via isRisingPrice on a view that excludes suspects',
}

/*
 * ★ THE SECOND FIELD FAMILY, ADDED AFTER THE FIRST GATE SHIPPED AND WAS NOT ENOUGH.
 *
 * The first version of this gate covered `firstUnitPrice`/`lastUnitPrice` and went to production
 * green. Reading the live page afterwards: the ramp headline was gone, the recommendation had
 * dropped from $1,832 to a peer band, and the page still said "Modeled buy value $237,387.80"
 * because THAT figure is 130 x `latest.effectiveUnitPrice`, a different field the gate never
 * looked at. Same wrong number, different road, past a gate written to stop exactly it.
 *
 * A gate is only as wide as the field list somebody thought of, so the list is now two families
 * and the lesson is recorded here rather than in a commit message nobody re-reads.
 */
const LATEST_PRICE_REVIEWED: Record<string, string> = {
  'lib/intelligence/awards/nsn-now.ts': 'the source: builds `latest` and the suspicion itself',
  'lib/intelligence/brief/package.ts': 'modeledBuyValue abstains with its own sentence, not the absent one',
  'lib/intelligence/scoring/cornerscore.ts': 'the whole pricing leg is unavailable(), anchor and trend',
  'lib/intelligence/monopoly-view.ts': 'latestPrice withheld; the priced filter excludes suspects',
  'lib/intelligence/suppliers/outreach-dossier.ts': 'no price quoted to a supplier off a suspect series',
  'app/(app)/documents/prefill-source.ts': 'unit_price withheld from the deliverable, award identity kept',
  'app/(app)/corner/[nsn]/page.tsx': 'the deal is created honestly valueless',
  'lib/compliance/deliverables/prefill.ts': 'carries price_withheld_reason so the abstention says which state it is',
}

describe('every reader of the LATEST award price has been reviewed', () => {
  it('has no unreviewed consumer', () => {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', 'latest\\??\\.effectiveUnitPrice|price_withheld_reason', '--', 'lib', 'app', 'components'],
      { encoding: 'utf8' },
    )
    const found = out.split('\n').map((l) => l.trim()).filter(Boolean)
    expect(found.length, 'the grep found nothing, so this gate is not gating').toBeGreaterThan(3)
    const unreviewed = found.filter((f) => !(f in LATEST_PRICE_REVIEWED))
    expect(
      unreviewed,
      'a new reader of the latest award price appeared. This is the family that reached production ' +
        'once already. Decide what it does when the series carries a decimal shift, then list it.',
    ).toEqual([])
  })
})

describe('every reader of the price endpoints has been reviewed against the decimal shift', () => {
  it('has no unreviewed consumer', () => {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', 'firstUnitPrice|lastUnitPrice', '--', 'lib', 'app', 'components'],
      { encoding: 'utf8' },
    )
    const found = out.split('\n').map((l) => l.trim()).filter(Boolean)
    expect(found.length, 'the grep found nothing, so this gate is not gating').toBeGreaterThan(3)

    const unreviewed = found.filter((f) => !(f in REVIEWED))
    expect(
      unreviewed,
      'a new reader of firstUnitPrice/lastUnitPrice appeared. Decide what it says when the ' +
        'series carries a decimal shift, then add it to REVIEWED with the answer.',
    ).toEqual([])
  })

  it('lists nothing that has since been deleted', () => {
    const out = execFileSync(
      'git',
      ['grep', '-l', '-E', 'firstUnitPrice|lastUnitPrice', '--', 'lib', 'app', 'components'],
      { encoding: 'utf8' },
    )
    const found = new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))
    // a stale allow-list entry is a licence nobody is using, and it hides that the reader moved
    expect([...Object.keys(REVIEWED)].filter((f) => !found.has(f))).toEqual([])
  })
})
