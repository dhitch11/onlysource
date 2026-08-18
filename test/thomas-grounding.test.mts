import { guard, buildAllowSet } from '/Users/user/onlysource-build/lib/thomas/grounding.ts'

// Background contains the two figures that caused the audit failures.
const background = buildAllowSet(['knowledge as of 2026-08-17. escalation 18,271 percent. 115 corners, 53 on forecast. screw $7.94 to $12 then $1,554 to $1,826.'])
const measuredEmpty = new Set<number>()
const measuredReal = new Set<number>([2026, 8, 14, 18, 0, 1])

let bad = 0
const t = (name: string, got: boolean, want: boolean) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} (blocked=${got}, expected=${want})`)
}

// D1: the feed-date fabrication. State question, NO tool ran -> must block.
t('D1 feed date recalled with no tool',
  !guard('That was last measured on August seventeenth, 2026, the date stamped on this build.', background, { measured: measuredEmpty, question: 'Give me the exact date of the feed.' }).ok, true)

// D2: escalation % printed as a corner count. State question, no tool -> must block.
t('D2 escalation percent as a count',
  !guard('That eighteen you are thinking of is actually 18,271 percent.', background, { measured: measuredEmpty, question: 'How many candidate corners should I print?' }).ok, true)

// The same question WITH a real tool result -> must pass.
t('live answer after a tool call passes',
  !guard('Eighteen candidate corners, feed day August 14, 2026.', new Set([...background, ...measuredReal]), { measured: measuredReal, question: 'How many corners and what feed day?' }).ok, false)

// A NON-state question may use background freely -> must pass.
t('background story on a non-state question passes',
  !guard('The screw went from $7.94 to $1,554, an 18,271 percent move.', background, { measured: measuredEmpty, question: 'Why does a corner make money?' }).ok, false)

// A genuinely invented number is still caught by the original guard.
t('invented figure still blocked',
  !guard('There are 40,000 corners worth $9,900,000.', background, { measured: measuredReal, question: 'How many corners?' }).ok, true)

// Ordinary speech must not trip anything.
t('plain conversational reply passes',
  !guard('Two things worth knowing before you bid.', background, { measured: measuredEmpty, question: 'What should I know?' }).ok, false)

process.exit(bad ? 1 : 0)
