#!/usr/bin/env node
/**
 * R0.1 / R0.3 / R0.4 / R0.5 — THE LINT GATE, AND ITS PROOF THAT IT IS ALIVE.
 *
 * =====================================================================================
 * WHY THIS FILE EXISTS, AND WHY ITS ABSENCE WAS THE MOST EXPENSIVE DEFECT IN THE REPO.
 * =====================================================================================
 * `package.json` has shipped `gate:r0`, `gate:r0:lints`, `gate:r0:selftest`,
 * `gate:r0:secrets` and `gate:all` since early in the build. Every one of them invoked
 * `scripts/lint-gates.mjs` and `scripts/secret-scan.mjs`. NEITHER FILE EXISTED. So
 * `npm run gate:all` — the command that gates a promote — died on a missing module, and
 * every requirement in the corpus phrased as "a build-failing assertion" had no build to
 * fail. There is also no `.github/workflows`, so nothing ran it anyway.
 *
 * A 12-agent audit of this estate returned 424 findings. Exactly SIX were "genuinely not
 * built", and all six named these two files, found independently by six agents reading six
 * different documents. Everything else was built-and-not-wired (149) or wired-but-
 * incomplete (143). **149 unwired modules is the shape you get when nothing mechanical is
 * watching.** This gate is that mechanism.
 *
 * =====================================================================================
 * THE DESIGN RULE: A LINT THAT CANNOT FAIL IS NOT A LINT, IT IS A COMMENT.
 * =====================================================================================
 * R0.1 does not say "all named lints green". It says "all named lints green, AND EVERY
 * LINT PROVEN LIVE BY ITS KNOWN-BAD FIXTURE". That second clause is the whole design.
 *
 * This repo has repeatedly shipped controls that reported success while inspecting nothing:
 * a CSS rule that shipped and did nothing; a guard that HEADed the wrong asset; a numeral
 * firewall that can report it stripped nothing but cannot show it WOULD have stripped
 * something. A green lint is indistinguishable from an unplugged lint unless you feed it
 * something it must reject. So every rule below carries `knownBad` — a snippet it MUST
 * flag — and `--selftest` fails if any rule accepts its own poison.
 *
 * ADDING A RULE: give it a `knownBad` AND a `knownGood`. The first proves it can fail; the
 * second proves it will not cry wolf, because a lint with false positives gets disabled and
 * a disabled lint is worse than no lint at all.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, extname } from 'node:path'

/**
 * ★ UNTRACKED FILES ARE NEVER BASELINED. THIRD TIME THIS TRAP FIRED TODAY.
 *
 * The reachability census learned this first (a peer lane caught it): recording a baseline
 * while agents are mid-build swallows their unfinished work as permanent accepted debt, so
 * the files MOST certain to need fixing become the ones the gate will never mention again.
 * I fixed it there. I did not carry the fix here, and this baseline promptly accepted
 * `model-sdk-outside-lib-ai | lib/thomas/claude.ts` — A SECOND ANTHROPIC CLIENT CREATED
 * TWELVE MINUTES EARLIER — as pre-existing debt, in the same hour I wrote the comment
 * warning about exactly this.
 *
 * A fix applied to one instrument and not its sibling is half a fix. Both baselines now
 * refuse untracked files, and the reason is that a violation you have never committed is
 * not debt: it is a decision you are still making.
 */
function untrackedFiles() {
  try {
    return new Set(
      execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean),
    )
  } catch {
    return new Set()
  }
}

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SCAN_DIRS = ['app', 'components', 'lib']
const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.mjs'])

/** Directories that are never product code. */
const SKIP_DIR = new Set(['node_modules', '.next', '.git', '.probe', 'data', 'test'])

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (CODE_EXT.has(extname(name))) out.push(full)
  }
  return out
}

/**
 * TWO DERIVED TEXTS, AND EVERY RULE MUST SAY WHICH ONE IT READS.
 *
 * MEASURED REASON THIS EXISTS: the first version of this file stripped comments AND string
 * literals for every rule, and the self-test immediately failed three of six rules. Two
 * could never fire at all, because THE THING THEY LOOK FOR IS ITSELF A STRING LITERAL — an
 * import specifier (`'@anthropic-ai/sdk'`) and a config value (`redirect: 'manual'`). A
 * rule that greps for a string in text with the strings removed is unfalsifiable, and it
 * would have reported "clean" forever.
 *
 * So there are two texts and the choice is explicit per rule:
 *
 *   `bare`  - comments removed, STRINGS INTACT. For rules whose evidence is a string:
 *             import specifiers, config values.
 *   `code`  - comments AND string contents removed. For rules whose evidence is syntax:
 *             `new Date()`, `title=`. This is not optional for those, because most files
 *             here carry header comments that NAME the banned pattern while explaining it,
 *             and a rule that flags its own documentation gets an ignore comment added,
 *             and that ignore then quietly covers a real violation later.
 *
 * Comments are stripped from BOTH, always: prose is never evidence.
 */
function deriveTexts(src) {
  let bare = ''
  let code = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      const start = i
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === quote) {
          i++
          break
        }
        if (src[i] === '\n' && quote !== '`') break
        i++
      }
      bare += src.slice(start, i)
      // Empty quotes keep token boundaries intact without leaking content.
      code += quote + quote
      continue
    }
    bare += c
    code += c
    i++
  }
  return { bare, code }
}

/** Report a violation with its 1-indexed line, found in the STRIPPED text. */
function hits(stripped, re) {
  const found = []
  const lines = stripped.split('\n')
  for (let l = 0; l < lines.length; l++) {
    const m = lines[l].match(re)
    if (m) found.push({ line: l + 1, text: lines[l].trim().slice(0, 120) })
  }
  return found
}

/* ==================================================================================== */
/* THE RULES                                                                            */
/* ==================================================================================== */

const RULES = [
  {
    id: 'raw-clock-in-domain',
    spec: 'R0.3',
    why:
      'Domain code must take an injectable clock. A raw read is untestable, and when its ' +
      'value crosses the server/client boundary it is a React #418 hydration mismatch that ' +
      'ONLY production shows — this repo has been burned by that three times.',
    reads: 'code',
    applies: (f) => f.startsWith('lib/') && !f.startsWith('lib/time/'),
    test: (t) => hits(t, /\bDate\.now\(\)|\bnew Date\(\s*\)/),
    knownBad: 'export function stamp() { return new Date().toISOString() }',
    knownGood: 'export function stamp(clock) { return clock.now() }',
  },
  {
    id: 'model-sdk-outside-lib-ai',
    spec: 'R0.5',
    why:
      'Every model call goes through lib/ai/ so that grounding, the model chain, budget caps ' +
      'and served-model reporting cannot be bypassed. An SDK import elsewhere is a path around ' +
      'all four at once.',
    // Evidence is an import specifier, which IS a string literal -> must read `bare`.
    reads: 'bare',
    applies: (f) => !f.startsWith('lib/ai/'),
    test: (t) => hits(t, /@anthropic-ai\/sdk|api\.anthropic\.com|['"]openai['"]|api\.openai\.com/),
    knownBad: "import Anthropic from '@anthropic-ai/sdk'\nconst c = new Anthropic()",
    knownGood: "import { generate } from '@/lib/ai/anthropic'",
  },
  {
    id: 'unschemad-json-parse-after-model',
    spec: 'R0.4',
    why:
      'JSON.parse on model output without a schema turns a malformed generation into a thrown ' +
      'error or, worse, a silently wrong object. Parse through a validator or do not parse.',
    reads: 'code',
    applies: (f) => f.startsWith('app/api/') || f.startsWith('lib/'),
    test: (t) => {
      // Only flag a JSON.parse in a file that also calls the model. A parse elsewhere is fine.
      if (!/\bgenerate\s*\(|messages\.create\s*\(/.test(t)) return []
      return hits(t, /JSON\.parse\s*\(/)
    },
    knownBad: 'const r = await generate(s, u)\nconst data = JSON.parse(r.text)',
    knownGood: 'const r = await generate(s, u)\nconst data = Schema.parse(r.text)',
  },
  {
    id: 'followed-redirect-read-as-ok',
    spec: 'R0.1 (bare-fetch)',
    why:
      'MEASURED LIVE DEFECT, not hypothetical. The edge proxy answers an unauthenticated POST ' +
      'with a 307 to /enter, fetch FOLLOWS it by default, /enter returns 200 HTML, and `r.ok` ' +
      'is therefore TRUE for a save that never happened — the operator sees a green tick. Any ' +
      'fetch whose result is judged by `.ok` must either set `redirect: "manual"` or assert the ' +
      'response is JSON before believing it.',
    // Evidence is a config VALUE (`redirect: 'manual'`), a string -> must read `bare`.
    reads: 'bare',
    applies: (f) => f.startsWith('app/') || f.startsWith('components/'),
    test: (t) => {
      if (!/\bfetch\s*\(/.test(t)) return []
      if (/redirect:\s*['"]manual['"]/.test(t)) return []
      // Asserting the response is JSON is the other acceptable proof.
      if (/content-type|headers\.get\s*\(/i.test(t)) return []
      return hits(t, /\.\s*ok\b/)
    },
    knownBad: "const r = await fetch('/api/x', { method: 'POST' })\nif (r.ok) setSaved(true)",
    knownGood:
      "const r = await fetch('/api/x', { method: 'POST', redirect: 'manual' })\nif (r.ok) setSaved(true)",
  },
  {
    id: 'title-attribute-as-information',
    spec: 'R0.1 (no title= on identifier cells)',
    why:
      'A `title` tooltip does not exist on a touch device, does not exist for a keyboard user, ' +
      'and is not announced reliably by screen readers. Information that lives only there is ' +
      'information most operators never receive. Use the ExplainButton popover.',
    reads: 'code',
    applies: (f) => f.startsWith('app/') || f.startsWith('components/'),
    /*
     * ONLY A DOM ELEMENT'S `title` ATTRIBUTE IS THE DEFECT.
     *
     * The first version matched any `title=` and returned 39 violations, of which the large
     * majority were `<Section title="...">` — a PROP on a React component, which is an
     * ordinary named argument and completely fine. That rule would have been disabled
     * within a day, and a disabled rule is worse than none.
     *
     * ★ THE LESSON, WORTH MORE THAN THE FIX: my known-good fixture DID pass, because it only
     * covered the shape I had thought of. A positive control is only as good as its
     * coverage — it proves a rule does not cry wolf on the cases you imagined, never on the
     * ones you did not. The component-prop shape is now a fixture precisely because the real
     * repo, not my imagination, produced it.
     *
     * So: the tag must be lowercase (JSX lowercases DOM elements and capitalises components),
     * and `<title>` itself is excluded because that element IS the accessible name.
     */
    test: (t) =>
      hits(t, /<[a-z][\w-]*(?:\s+[^<>]*?)?\s+title=/).filter((h) => !/<\/?title[\s>]/i.test(h.text)),
    knownBad: '<td title={row.fullValue}>{row.short}</td>',
    knownGood: [
      '<td>{row.short}<ExplainButton helpId="row.value" /></td>',
      // A component prop named `title` is a named argument, not a tooltip.
      '<Section title="Identifier, Money, ScoreRing" note="...">{kids}</Section>',
      // An SVG/document <title> element is the accessible name and is correct.
      '<svg><title>Corner-ability</title><path d="..." /></svg>',
    ],
  },
  /*
   * ============================================================================
   * THE THREE RULES BELOW WERE SPECIFIED BY THE @WARROOM-AUDIT LANE, and each one
   * is derived from a defect that ACTUALLY SHIPPED IN THIS REPO and was found by
   * hand today. That is the point: every rule here is a scar, not a style
   * preference, so each `knownBad` is a real line that was really live.
   * ============================================================================
   */
  {
    id: 'provenance-on-a-literal',
    spec: 'R0.1 (nothing pretends)',
    why:
      'A number written as a literal cannot have been measured, so a literal wearing ' +
      'provenance="measured" is a fabrication certified by the very glyph that exists to ' +
      'certify measurement. Found live on /design at three sites, which is the page that ' +
      'TEACHES the design system — so it was teaching that `measured` is decoration.',
    // ★ THIRD TIME THIS TRAP: the evidence is the string VALUE "measured", so `code` (which
    // empties string contents) can never match it. Two earlier rules failed the self-test the
    // same way. The lesson is not "remember to pick bare" -- it is that a rule whose evidence
    // lives inside a literal is unfalsifiable against stripped text, and only the known-bad
    // fixture makes that visible instead of shipping as a permanent green.
    reads: 'bare',
    applies: (f) => f.startsWith('app/') || f.startsWith('components/'),
    // Same tag, both attributes, literal amount. Order-independent.
    test: (t) =>
      hits(
        t,
        /<\w+[^<>]*(?:amount=\{\s*-?[\d.]+\s*\}[^<>]*provenance=\{?["']measured|provenance=\{?["']measured["']?[^<>]*amount=\{\s*-?[\d.]+\s*\})/,
      ),
    knownBad: '<Money amount={9827} provenance="measured" />',
    knownGood: [
      '<Money amount={row.lastUnitPrice} provenance="measured" />',
      // A literal is fine when it does not claim to have been measured.
      '<Money amount={412000} provenance="modelled" />',
      '<Money amount={null} provenance="insufficient" absentReason="no award history" />',
    ],
  },
  {
    id: 'explainbutton-inside-a-paragraph',
    spec: 'R0.1 (hydration integrity)',
    why:
      'ExplainButton renders its popover as a SIBLING <div popover>. A <div> is not phrasing ' +
      'content, so the HTML parser force-closes an enclosing <p> before it; the server tree ' +
      'and the client tree then disagree and React throws #418. This has now shipped to ' +
      'production THREE times in this repo (AdminConsole at 8 errors per load, /competitor, ' +
      'and /groups twice). It is invisible to dev, to typecheck and to a grep of the source, ' +
      'and it appears only as a console error on the deployed page. An element that may ' +
      'contain an ExplainButton can never be a <p>.',
    // `code` strips comments — and it must, because three files carry comments EXPLAINING
    // this defect, and a first pass of this sweep flagged all three as violations. The
    // instrument read prose as evidence. Preprocessing is part of the instrument.
    reads: 'code',
    applies: (f) => f.startsWith('app/') || f.startsWith('components/'),
    test: (t) => {
      const out = []
      const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g
      let m
      while ((m = re.exec(t))) {
        if (!/ExplainButton/.test(m[1])) continue
        out.push({ line: t.slice(0, m.index).split('\n').length, text: '<p> encloses an ExplainButton' })
      }
      return out
    },
    knownBad: '<p className={s.sub}>Some prose<ExplainButton helpId="x" /></p>',
    knownGood: [
      '<div className={s.sub}>Some prose<ExplainButton helpId="x" /></div>',
      '<p className={s.sub}>Prose with no explainer at all.</p>',
      '<span className={s.head}>Class<ExplainButton helpId="x" /></span>',
    ],
  },
  {
    id: 'design-gallery-linked-from-an-operator-surface',
    spec: 'R0.1 (nothing pretends) — the precondition of the /design lint EXCEPTION',
    why:
      'The lint baseline grants /design ONE permanent EXCEPTION: it may render a literal ' +
      'wearing provenance="measured", because it is the component gallery and the glyph ' +
      'itself is its subject. THAT HOLDS ONLY WHILE /design IS UNREACHABLE FROM THE OPERATOR ' +
      'NAV. Link it from an operator surface and every swatch becomes what it originally was ' +
      '— a fabricated dollar figure certified as measured, in front of somebody deciding what ' +
      'to bid. So the precondition is enforced here rather than written in a comment, because ' +
      'a condition nobody checks is a condition that quietly stops being true.',
    reads: 'bare',
    // The gallery may of course link to itself; only OTHER surfaces are the violation.
    applies: (f) =>
      (f.startsWith('app/') || f.startsWith('components/')) && !f.startsWith('app/(app)/design/'),
    test: (t) => hits(t, /href=\{?['"]\/design['"]|['"]\/design['"]\s*[,}\]]/),
    knownBad: "{ href: '/design', label: 'Design system', icon: 'design' },",
    knownGood: [
      "{ href: '/board', label: 'The Board', icon: 'board' },",
      // Naming it in prose is fine. Linking it is not.
      "const note = 'The /design gallery stays internal and deliberately unlisted.'",
    ],
  },
  {
    id: 'hardcoded-identity',
    spec: 'R0.1 (nothing fabricated)',
    why:
      'A person\'s name written into a component is shown to every account that signs in. ' +
      'The live instance sat in the SHELL, so it rendered on 100% of authenticated page ' +
      'views, told every user they held the `Owner` role while the server-side lockout said ' +
      'otherwise, and carried a stale project codename. The real name was available from ' +
      'lib/auth/accounts.ts the whole time; the chrome printed over the top of it.',
    reads: 'bare',
    applies: (f) => f.startsWith('app/') || f.startsWith('components/'),
    test: (t) => hits(t, /\bname:\s*['"][A-Z][a-z]+ [A-Z][a-z]+['"]/),
    knownBad: "user={{ name: 'David Hitchman', role: 'Owner', title: 'ProjectX' }}",
    knownGood: [
      'user={{ name: account.name, role: account.role.name, title: account.email }}',
      // A stated absence is not an identity.
      "user={{ name: 'No account', role: 'Break-glass session' }}",
    ],
  },
  {
    id: 'home-path-literal',
    spec: 'R0.1 (environment portability)',
    why:
      'An absolute home path resolves on exactly one machine. Everywhere else the read ' +
      'fails and the surface renders an EMPTY STATE, which an operator reads as "no data" ' +
      'rather than "wrong path" — a silent, misattributed failure. lib/data-root.ts exists ' +
      'precisely so no other file needs a literal.',
    reads: 'bare',
    applies: (f) => f.startsWith('app/') || f.startsWith('lib/') || f.startsWith('components/'),
    test: (t) => hits(t, /['"`]\/(?:Users|home)\/[a-z][\w.-]*\//i),
    knownBad: "const root = '/Users/user/onlysource-build/data'",
    knownGood: [
      "import { resolveDataRoot } from '@/lib/data-root'",
      "const root = process.env.ONLYSOURCE_DATA_ROOT ?? join(cwd(), 'data')",
    ],
  },
  {
    id: 'demo-flag-branches-a-call-path',
    spec: 'R0.1 (no call-path branch on a demo flag)',
    why:
      'A demo flag that changes which code runs means the demo is not the product, and the path ' +
      'the customer exercises was never the path that was tested. Gate DATA VOLUME, never the ' +
      'call path.',
    reads: 'code',
    applies: (f) => f.startsWith('app/') || f.startsWith('lib/') || f.startsWith('components/'),
    test: (t) => hits(t, /if\s*\([^)]*\b(isDemo|DEMO_MODE|demoMode)\b/),
    knownBad: 'if (isDemo) { return fakeRows() }\nreturn realRows()',
    knownGood: 'const limit = isDemo ? 25 : 500\nreturn realRows(limit)',
  },
]

/* ==================================================================================== */
/* THE SELF-TEST: PROVE EVERY RULE CAN FAIL, AND PROVE IT DOES NOT CRY WOLF             */
/* ==================================================================================== */

function selftest() {
  const failures = []
  for (const rule of RULES) {
    const bad = rule.test(deriveTexts(rule.knownBad)[rule.reads])
    if (bad.length === 0) {
      failures.push(
        `${rule.id}: DID NOT FLAG ITS KNOWN-BAD FIXTURE. The rule is unplugged; a green run ` +
          `from it proves nothing.`,
      )
    }
    // knownGood may be one fixture or many. Many is better: see the title= rule, whose
    // single fixture passed while the rule produced 39 false positives on the real repo.
    const goods = Array.isArray(rule.knownGood) ? rule.knownGood : [rule.knownGood]
    for (const g of goods) {
      const good = rule.test(deriveTexts(g)[rule.reads])
      if (good.length > 0) {
        failures.push(
          `${rule.id}: FLAGGED A KNOWN-GOOD FIXTURE (${JSON.stringify(g.slice(0, 60))}). A rule ` +
            `with false positives gets disabled, and a disabled rule is worse than none.`,
        )
      }
    }
  }
  if (failures.length) {
    console.error('\nLINT SELF-TEST FAILED — the gate cannot be trusted:\n')
    for (const f of failures) console.error('  ✗ ' + f)
    console.error('')
    process.exit(1)
  }
  console.log(`lint self-test: ${RULES.length}/${RULES.length} rules proven live (each rejects its known-bad fixture and accepts its known-good).`)
}

/* ==================================================================================== */

/**
 * A RATCHET, FOR THE SAME REASON THE REACHABILITY CENSUS IS ONE.
 *
 * Turning this gate on found 28 pre-existing violations. A gate that is red on the day it
 * ships gets switched off within a week, and a switched-off gate is worse than none — which
 * is precisely how this repo ended up with `gate:r0` pointing at two files that did not
 * exist. So existing violations are recorded in `.lint-baseline.json` and the gate fails
 * only on a NEW one. The debt is visible in every run, it is named, and it cannot grow.
 *
 * A baseline entry is `rule|file` -> COUNT, deliberately NOT including the line number.
 * Line numbers churn on every unrelated edit above a violation, and a gate that goes red
 * when you add an import dies of noise within a week.
 *
 * ★ THE COUNT IS WHAT CLOSES THE HOLE. Keying on `rule|file` alone would let a SECOND
 * violation of the same rule hide inside an already-listed file forever — the ratchet would
 * accept new debt as long as it landed somewhere already dirty. Storing the count means
 * 3 -> 4 fails while an edit above the third still passes, so the gate is stable under
 * churn and strict about growth. (Suggested by the @WARROOM-AUDIT lane, which spotted the
 * hole in the first version.)
 *
 * It also ratchets DOWNWARD for free: when a fix lands the count drops, the run says so, and
 * `--update-baseline` banks it. The debt becomes a number that can only go down.
 *
 * =====================================================================================
 * EVERY ACCEPTED PAIR CARRIES A REASON, AND THERE ARE ONLY TWO KINDS
 * =====================================================================================
 * `EXCEPTION` — the rule is right in general and wrong here, permanently. It is not debt
 *               and nobody should "fix" it. Example: `/design` is a component GALLERY, so
 *               it must render what `provenance="measured"` looks like; a swatch is the one
 *               place a literal legitimately wears the glyph. Removing it would delete the
 *               page's purpose.
 * `DEBT`      — a real violation nobody has fixed yet. It is owed, and the count only goes
 *               down.
 *
 * Without this split the baseline lies in the most expensive direction: it makes permanent
 * exceptions look like a backlog that will one day be cleared, and it makes real debt look
 * like a decision somebody made. An unexplained accepted violation is indistinguishable
 * from a silenced one, which is how a ratchet becomes a place defects go to be forgotten.
 */
const LINT_BASELINE = join(ROOT, '.lint-baseline.json')
const keyOf = (v) => `${v.rule}|${v.file}`

function run() {
  const files = SCAN_DIRS.filter((d) => existsSync(join(ROOT, d))).flatMap((d) =>
    walk(join(ROOT, d)),
  )
  const violations = []
  for (const abs of files) {
    const rel = relative(ROOT, abs)
    let src
    try {
      src = readFileSync(abs, 'utf8')
    } catch {
      continue
    }
    const texts = deriveTexts(src)
    for (const rule of RULES) {
      if (!rule.applies(rel)) continue
      for (const h of rule.test(texts[rule.reads])) {
        violations.push({ rule: rule.id, spec: rule.spec, file: rel, ...h })
      }
    }
  }

  console.log(`lint gate: ${RULES.length} rules over ${files.length} files.`)

  if (process.argv.includes('--update-baseline')) {
    const untracked = untrackedFiles()
    const skipped = violations.filter((v) => untracked.has(v.file))
    const counts = {}
    for (const v of violations) {
      if (untracked.has(v.file)) continue // in flight, not debt
      counts[keyOf(v)] = (counts[keyOf(v)] ?? 0) + 1
    }
    if (skipped.length) {
      console.log(
        `lint baseline: ${skipped.length} violation(s) in UNTRACKED files NOT baselined (in flight, ` +
          `must be fixed or explicitly accepted before commit):`,
      )
      for (const k of [...new Set(skipped.map(keyOf))]) console.log(`  ~ ${k}`)
    }
    const accepted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
    writeFileSync(LINT_BASELINE, JSON.stringify({ accepted }, null, 2) + '\n')
    console.log(
      `lint baseline updated: ${violations.length} violation(s) across ${Object.keys(accepted).length} rule|file pair(s) recorded.`,
    )
    return 0
  }

  const raw = existsSync(LINT_BASELINE) ? JSON.parse(readFileSync(LINT_BASELINE, 'utf8')) : {}
  // `accepted` was an array of keys in the first version; it is a {key: count} map now.
  // Entry shapes, oldest first: a bare key array, then {key: count}, now
  // {key: {count, kind, reason}}. All three read, so an old baseline never hard-fails a run.
  const meta = new Map()
  const known = new Map(
    Array.isArray(raw.accepted)
      ? raw.accepted.map((k) => [k, Number.POSITIVE_INFINITY])
      : Object.entries(raw.accepted ?? {}).map(([k, v]) => {
          if (v && typeof v === 'object') {
            meta.set(k, v)
            return [k, v.count ?? 0]
          }
          return [k, v]
        }),
  )

  const nowCount = new Map()
  for (const v of violations) nowCount.set(keyOf(v), (nowCount.get(keyOf(v)) ?? 0) + 1)

  if (known.size) {
    const total = [...known.values()].reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
    const exceptions = [...meta.values()].filter((m) => m.kind === 'EXCEPTION').length
    const debt = known.size - exceptions
    console.log(
      `lint gate: ${total} accepted violation(s) across ${known.size} pair(s) — ` +
        `${debt} DEBT (owed, count only goes down), ${exceptions} EXCEPTION (permanent, with a stated reason).`,
    )
    // An unreasoned acceptance is how a ratchet becomes a place defects go to be forgotten.
    const unreasoned = [...known.keys()].filter((k) => !meta.has(k))
    if (unreasoned.length) {
      console.log(`lint gate: ${unreasoned.length} accepted pair(s) carry NO stated reason. Re-run --update-baseline and classify them.`)
    }
    const improved = []
    for (const [k, was] of known) {
      const now = nowCount.get(k) ?? 0
      if (Number.isFinite(was) && now < was) improved.push(`${k}  ${was} -> ${now}`)
    }
    if (improved.length) {
      console.log(`lint gate: ${improved.length} pair(s) IMPROVED - run --update-baseline to bank it:`)
      for (const i of improved) console.log(`  + ${i}`)
    }
  }

  // A violation is NEW if its rule|file pair exceeds the accepted count for that pair.
  const budget = new Map(known)
  const fresh = []
  for (const v of violations) {
    const k = keyOf(v)
    const left = budget.get(k) ?? 0
    if (left > 0) budget.set(k, left - 1)
    else fresh.push(v)
  }

  if (fresh.length === 0) {
    console.log('lint gate: no new violations.')
    return 0
  }
  violations.length = 0
  violations.push(...fresh)

  const byRule = new Map()
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, [])
    byRule.get(v.rule).push(v)
  }
  console.error(`\nLINT GATE: ${violations.length} NEW violation(s) across ${byRule.size} rule(s).\n`)
  for (const [id, vs] of byRule) {
    const rule = RULES.find((r) => r.id === id)
    console.error(`  ${id}  [${rule.spec}]  ${vs.length} violation(s)`)
    console.error(`    ${rule.why.replace(/\s+/g, ' ')}`)
    for (const v of vs.slice(0, 12)) console.error(`      ${v.file}:${v.line}  ${v.text}`)
    if (vs.length > 12) console.error(`      ... and ${vs.length - 12} more`)
    console.error('')
  }
  return 1
}

if (process.argv.includes('--selftest')) {
  selftest()
} else {
  process.exit(run())
}
