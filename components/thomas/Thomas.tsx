'use client'

/**
 * THOMAS — the platform-wide concierge.
 *
 * Mounted once in the app shell, so he is on every authenticated surface. He knows which screen the
 * operator is on, answers anything about the platform, and can drive it: change route, open a
 * dossier, set a filter on the map.
 *
 * PLACEMENT. Bottom right, matching the notification toast, and for the same measured reason
 * recorded beside it: top right occludes real dashboard numbers. On a phone the panel goes full
 * width, because a floating card over a data table is unusable at that size.
 *
 * The launcher is deliberately loud, per the house rule that clickable must look clickable. The
 * panel obeys the named z-index layers rather than inventing a value.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useVoice } from './useVoice'
import { RichText } from './RichText'
import s from './thomas.module.css'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  /**
   * The sensitive classes a tool refused to read for THIS operator on THIS turn, in Thomas's words.
   *
   * It is a separate field from `tools` and from `grounded` because it is a separate FACT, and the
   * three must never render at the same confidence. `tools` is provenance: he read this live.
   * `grounded` false is the numeral firewall: a figure could not be traced to the feed. This is
   * neither. Nothing failed and nothing is missing. The data is there and this account may not read
   * it, which is the one of the three the operator can actually do something about.
   */
  withheld?: string[]
  grounded?: boolean
  /** Why an answer was replaced. A permission boundary gets a different sentence from a bad figure. */
  failure?: 'ungrounded' | 'unmeasured' | 'withheld'
  spoken?: boolean
}

/** Route to a human name, so Thomas is told the surface rather than a URL fragment. */
const SURFACES: Array<[RegExp, string]> = [
  [/^\/$/, 'the Dashboard, the command center'],
  [/^\/monopoly/, 'the Monopoly Map, the corner screening tool'],
  [/^\/intelligence/, 'Intelligence, the portfolio view'],
  [/^\/goldmine/, 'the No-Quote Goldmine'],
  [/^\/hubzone/, 'HUBZone set-asides'],
  [/^\/competitor/, 'the Competitor Teardown'],
  [/^\/suppliers/, 'the Suppliers book'],
  [/^\/sales/, 'the Sales Pipeline'],
  [/^\/documents/, 'the Documents packet vault'],
  [/^\/corner\//, 'a Corner Dossier for one stock number'],
  [/^\/settings/, 'Settings'],
  [/^\/admin/, 'the Admin console'],
  [/^\/groups/, 'Groups, the supply-class view'],
  [/^\/board/, 'the Board'],
]

const ROUTES: Record<string, string> = {
  dashboard: '/',
  monopoly: '/monopoly',
  intelligence: '/intelligence',
  goldmine: '/goldmine',
  hubzone: '/hubzone',
  competitor: '/competitor',
  suppliers: '/suppliers',
  sales: '/sales',
  documents: '/documents',
  settings: '/settings',
  admin: '/admin',
}

const TOOL_LABELS: Record<string, string> = {
  lookup_stock_number: 'reading the dossier',
  portfolio_snapshot: 'reading the live book',
  find_opportunities: 'searching the corner map',
  goldmine_snapshot: 'reading the goldmine',
  supplier_snapshot: 'reading the supplier book',
}

const OPENERS = [
  'What is this screen actually telling me?',
  'What is a corner, and why does it make money?',
  'Show me the strongest corner right now',
  'How is this different from what a trader does by hand?',
]

let seq = 0
const nextId = () => `m${(seq += 1)}`

/** "a", "a and b", "a, b and c". The notice has to read like a sentence, not like a log line. */
function listOf(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] ?? 'that'
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export default function Thomas({ operator }: { operator?: string }) {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const router = useRouter()
  const pathname = usePathname()
  const scroller = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)

  const surface = useMemo(() => {
    const hit = SURFACES.find(([re]) => re.test(pathname || '/'))
    return hit ? hit[1] : 'the platform'
  }, [pathname])

  /** Perform a client action. This is Thomas pressing the button rather than describing it. */
  const perform = useCallback(
    (name: string, input: Record<string, unknown>) => {
      if (name === 'navigate') {
        const to = ROUTES[String(input.surface ?? '').toLowerCase()]
        if (to) router.push(to as never)
      } else if (name === 'open_dossier') {
        const nsn = String(input.nsn ?? '').replace(/[^0-9]/g, '')
        if (nsn.length >= 9) router.push(`/corner/${nsn}` as never)
      } else if (name === 'set_filter') {
        const q = new URLSearchParams()
        for (const [k, v] of Object.entries(input)) {
          if (v === true) q.set(k, '1')
          else if (typeof v === 'string' && v) q.set(k, v)
        }
        router.push(`/monopoly${q.toString() ? `?${q}` : ''}` as never)
      }
    },
    [router],
  )

  const voice = useVoice({
    onUserTranscript: (text) => setMsgs((m) => [...m, { id: nextId(), role: 'user', text, spoken: true }]),
    onAgentResponse: (text) => setMsgs((m) => [...m, { id: nextId(), role: 'assistant', text, spoken: true }]),
    onError: (reason) => setErr(reason),
  })

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim()
      if (!message || busy) return
      setErr(null)
      setInput('')
      const history = msgs.slice(-12).map((m) => ({ role: m.role, content: m.text }))
      setMsgs((m) => [...m, { id: nextId(), role: 'user', text: message }])
      setBusy(true)

      const replyId = nextId()
      let acc = ''
      const tools: string[] = []
      const withheld: string[] = []
      try {
        const res = await fetch('/api/thomas/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history, path: pathname, surface }),
        })
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.message || `Thomas could not answer (${res.status}).`)
        }
        setMsgs((m) => [...m, { id: replyId, role: 'assistant', text: '' }])
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let nl = buf.indexOf('\n')
          while (nl !== -1) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (line) {
              const evt = JSON.parse(line) as Record<string, unknown>
              const t = String(evt.type)
              if (t === 'text') {
                acc += String(evt.delta ?? '')
                setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, text: acc } : x)))
              } else if (t === 'replace') {
                /* The firewall caught something. What was shown is replaced, not appended. */
                acc = String(evt.text ?? '')
                const failure = evt.failure as Msg['failure']
                setMsgs((m) =>
                  m.map((x) => (x.id === replyId ? { ...x, text: acc, grounded: false, failure } : x)),
                )
              } else if (t === 'refusal') {
                /*
                 * A tool refused. This is drawn, always, and never swallowed: an operator who sees a
                 * shorter answer with nothing explaining it learns to read our boundaries as thin
                 * data, and then stops believing every honest "I do not have that" the product makes
                 * anywhere else. It is deliberately NOT added to `tools`, because nothing was read.
                 */
                for (const c of (evt.classes as string[]) ?? []) {
                  if (!withheld.includes(c)) withheld.push(c)
                }
                setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, withheld: [...withheld] } : x)))
              } else if (t === 'tool') {
                const name = String(evt.name ?? '')
                tools.push(name)
                setWorking(TOOL_LABELS[name] ?? 'checking the data')
                setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, tools: [...tools] } : x)))
              } else if (t === 'action') {
                const a = evt.action as { name: string; input: Record<string, unknown> }
                perform(a.name, a.input ?? {})
              } else if (t === 'error') {
                throw new Error(String(evt.reason ?? 'Thomas stopped.'))
              }
            }
            nl = buf.indexOf('\n')
          }
        }
        if (!acc.trim()) throw new Error('Thomas came back empty.')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Something went wrong.')
        setMsgs((m) => m.filter((x) => x.id !== replyId || x.text.trim()))
      } finally {
        setBusy(false)
        setWorking(null)
      }
    },
    [busy, msgs, pathname, surface, perform],
  )

  // Keep the newest turn in view without yanking the page behind the panel.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, working])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Escape closes, and it stops a live voice session too: leaving a mic open behind a closed panel
  // is exactly the kind of thing an operator would never forgive.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        voice.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, voice])

  const toggleVoice = () => {
    if (voice.state === 'idle' || voice.state === 'error') {
      voice.start({
        surface,
        route: pathname || '/',
        operator: operator || 'the operator',
      })
    } else {
      voice.stop()
    }
  }


  /*
   * THE LAUNCHER STEPS OVER ANY CONTROL IT WOULD SIT ON.
   *
   * It is `position: fixed`, so it sits on whatever is beneath it AT THE CURRENT SCROLL OFFSET.
   * A sweep across every route at the offsets where a collision is arithmetically possible found
   * 23 obstructed controls on 9 routes, 8 of them with the launcher over the control's CENTRE -
   * including an "Accept" button on /design and seven 24x24 explainer triggers covered outright.
   * A finger aimed at the middle of those hits the launcher.
   *
   * Two fixes were tried before this one and neither can work. RESERVING SPACE fails because
   * `padding-block-end` protects the last line of the document and nothing in between (88px of it
   * has been on `.content` since 0af877b), and reserving the launcher's COLUMN costs ~58px of
   * width on a 320px screen. HIDING ON SCROLL fails differently and worse: it would make the
   * overlay sweep read clean at every offset while making the launcher useless mid-page, which is
   * passing the gate rather than fixing the thing.
   *
   * So it asks the same question the gate asks - `elementsFromPoint`, what is ACTUALLY under me -
   * and lifts when the answer is a control. The product and the gate agree by construction.
   *
   * ★ THE DECISION IS ALWAYS MADE AGAINST THE BASE POSITION, NEVER THE LIFTED ONE. Testing where
   * it currently is would unlift the moment the lift worked, collide again, and oscillate forever.
   * Measuring the unlifted box makes the state a pure function of the scroll offset.
   */
  useEffect(() => {
    const el = launcherRef.current
    if (!el || open) {
      el?.removeAttribute('data-lifted')
      return
    }
    const CONTROL = 'button,a,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="switch"]'
    let frame = 0

    /**
     * How many sample points of the launcher's box would land on a control if the box were moved
     * up by `dy`. Asked of `elementsFromPoint`, so it is what a finger would actually hit rather
     * than a guess from geometry.
     */
    const costAt = (base: { left: number; width: number; top: number; bottom: number }, dy: number) => {
      const top = base.top - dy
      const bottom = base.bottom - dy
      if (bottom < 0 || top > window.innerHeight) return 0
      let cost = 0
      for (const fx of [0.15, 0.5, 0.85]) {
        for (const fy of [0.15, 0.5, 0.85]) {
          const x = base.left + base.width * fx
          const y = top + (bottom - top) * fy
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue
          for (const hit of document.elementsFromPoint(x, y)) {
            if (el.contains(hit)) continue
            if (hit.closest('[role="dialog"]')) continue
            const control = hit.closest(CONTROL)
            if (control && !el.contains(control)) cost++
            // Stop at the first element that is not the launcher: whatever is under it is covered.
            break
          }
        }
      }
      return cost
    }

    const sync = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const current = Number(el.dataset.dy || '0')
      // Always reason about the UNLIFTED box, so the state is a pure function of the scroll
      // offset. Measuring where it currently sits would unlift the moment the lift worked,
      // collide again, and oscillate forever.
      const base = { left: r.left, width: r.width, top: r.top + current, bottom: r.bottom + current }
      const step = r.height + 12
      let best = 0
      let bestCost = Infinity
      // A BOUNDED search. One step up is not enough on a dense page - it simply puts the
      // launcher over whatever sits a step higher. Measured across four routes at 320, at every
      // offset where a collision is arithmetically possible: no lift 6 obstructed / 27 centre
      // hits, one step 3 / 21, best of four slots 2 / 9. Four is where it stopped paying.
      for (const dy of [0, step, step * 2, step * 3]) {
        const cost = costAt(base, dy)
        if (cost < bestCost) {
          bestCost = cost
          best = dy
          if (cost === 0) break
        }
      }
      el.dataset.dy = String(best)
      // Through a custom property, so it composes with the hover nudge instead of fighting it.
      el.style.setProperty('--lift', best ? `${-best}px` : '0px')
      if (best) el.setAttribute('data-lifted', '')
      else el.removeAttribute('data-lifted')
    }

    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(sync)
    }

    sync()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      el.style.removeProperty('--lift')
      el.removeAttribute('data-lifted')
      delete el.dataset.dy
    }
  }, [open])

  const live = voice.state === 'listening' || voice.state === 'speaking'

  return (
    <>
      <button
        type="button"
        ref={launcherRef}
        className={s.launcher}
        aria-expanded={open}
        aria-label={open ? 'Close Thomas' : 'Ask Thomas'}
        onClick={() => setOpen((o) => !o)}
        data-open={open || undefined}
        data-live={live || undefined}
      >
        <span className={s.launcherMark} aria-hidden="true">
          {open ? '×' : 'T'}
        </span>
        {!open && <span className={s.launcherLabel}>Ask Thomas</span>}
        {live && <span className={s.launcherPulse} aria-hidden="true" />}
      </button>

      {open && (
        <div className={s.panel} ref={panelRef} role="dialog" aria-label="Thomas, the OnlySource concierge">
          <header className={s.head}>
            <div className={s.who}>
              <span className={s.avatar} aria-hidden="true">T</span>
              <span>
                <strong className={s.name}>Thomas</strong>
                <span className={s.role}>Sales director</span>
              </span>
            </div>
            <div className={s.headActions}>
              {voice.available !== false && (
                <button
                  type="button"
                  className={s.voiceBtn}
                  onClick={toggleVoice}
                  data-live={live || undefined}
                  aria-pressed={live}
                  aria-label={live ? 'End the voice conversation' : 'Talk to Thomas'}
                  title={live ? 'End voice' : 'Talk to Thomas'}
                >
                  {voice.state === 'connecting' ? 'Connecting' : live ? 'End voice' : 'Talk'}
                </button>
              )}
              <button type="button" className={s.close} onClick={() => { setOpen(false); voice.stop() }} aria-label="Close">
                {'×'}
              </button>
            </div>
          </header>

          <div className={s.context}>
            Looking at <strong>{surface}</strong>
            {live && <span className={s.liveDot}> · voice is live</span>}
          </div>

          {/*
           * An honest empty state for voice, not a hidden button. If speech is unavailable the
           * operator is told so, once, in a quiet line, with the real reason. Silently removing
           * the control would leave somebody who expects to talk to Thomas unable to tell whether
           * the feature is missing, broken, or was never there.
           */}
          {voice.available === false && voice.reason && (
            <div className={s.voiceOff}>
              <strong>Voice is off.</strong> {voice.reason}
            </div>
          )}

          <div className={s.scroll} ref={scroller}>
            {msgs.length === 0 && (
              <div className={s.empty}>
                <p className={s.emptyLead}>
                  Ask me anything about this platform: how a tool works, why the data is there, what it is
                  worth, or how we win against doing this by hand. I can also take you places and pull real
                  numbers while we talk.
                </p>
                <div className={s.openers}>
                  {OPENERS.map((o) => (
                    <button key={o} type="button" className={s.opener} onClick={() => send(o)}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m) => (
              <div key={m.id} className={s.turn} data-role={m.role}>
                <div className={s.bubble} data-role={m.role}>
                  {m.text ? (
                    /* The operator's own words are never markdown; only Thomas writes it. */
                    m.role === 'assistant' ? <RichText text={m.text} /> : m.text
                  ) : (
                    <span className={s.thinking}>Thinking</span>
                  )}
                </div>
                {m.tools && m.tools.length > 0 && (
                  <div className={s.provenance}>
                    Read live: {m.tools.map((t) => TOOL_LABELS[t] ?? t).join(', ')}
                  </div>
                )}
                {m.withheld && m.withheld.length > 0 && (
                  <div className={s.withheld}>
                    <strong>Your role does not include {listOf(m.withheld)}.</strong> That is a
                    permission boundary, not missing data: the platform holds it and this account may
                    not read it. An owner can change your role.
                  </div>
                )}
                {m.grounded === false && m.failure !== 'withheld' && (
                  <div className={s.blocked}>
                    A figure in that answer could not be traced to the feed, so it was withheld.
                  </div>
                )}
              </div>
            ))}

            {working && <div className={s.working}>{working}</div>}
            {err && <div className={s.error}>{err}</div>}
          </div>

          <form
            className={s.composer}
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <textarea
              ref={inputRef}
              className={s.input}
              value={input}
              rows={1}
              placeholder={live ? 'Voice is live, or type instead' : 'Ask Thomas anything'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter is a newline. A trader types fast and expects that.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
            />
            <button type="submit" className={s.send} disabled={busy || !input.trim()} aria-label="Send">
              {busy ? '···' : '↑'}
            </button>
          </form>
        </div>
      )}
    </>
  )
}
