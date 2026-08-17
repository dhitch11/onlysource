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
import s from './thomas.module.css'

type Msg = {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools?: string[]
  grounded?: boolean
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
                /* The firewall caught an ungrounded figure. What was shown is replaced, not appended. */
                acc = String(evt.text ?? '')
                setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, text: acc, grounded: false } : x)))
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

  const live = voice.state === 'listening' || voice.state === 'speaking'

  return (
    <>
      <button
        type="button"
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
                  {m.text || <span className={s.thinking}>Thinking</span>}
                </div>
                {m.tools && m.tools.length > 0 && (
                  <div className={s.provenance}>
                    Read live: {m.tools.map((t) => TOOL_LABELS[t] ?? t).join(', ')}
                  </div>
                )}
                {m.grounded === false && (
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
