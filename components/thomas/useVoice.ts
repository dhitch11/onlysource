'use client'

/**
 * THE VOICE TRANSPORT — a raw WebSocket to ElevenLabs Conversational AI.
 *
 * Deliberately dependency-free. The official React SDK would do this, but adding it means editing
 * package.json, which is inside another lane's blast radius on this shared tree, and it would pull a
 * bundle to solve a problem that is genuinely about a hundred lines of well-understood audio code.
 * Owning the transport also means the microphone can be released the instant a session ends, which
 * matters more than convenience: a chat widget that quietly holds an open mic is a trust problem.
 *
 * THE PROTOCOL, as ElevenLabs actually speaks it:
 *   out  { type: 'conversation_initiation_client_data', dynamic_variables }   once, on open
 *   out  { user_audio_chunk: <base64 pcm16 mono 16k> }                        continuously
 *   out  { type: 'pong', event_id }                                           answering every ping
 *   in   { type: 'ping', ping_event: { event_id } }                           keepalive, MUST answer
 *   in   { type: 'audio', audio_event: { audio_base_64 } }                    agent speech to play
 *   in   { type: 'user_transcript', ... }                                     what it heard
 *   in   { type: 'agent_response', ... }                                      what it said
 *   in   { type: 'interruption', ... }                                        stop playing immediately
 *
 * A missed pong drops the socket after a few seconds and reads exactly like a crash, so the pong
 * handler is not optional politeness. It is the keepalive.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'

const SAMPLE_RATE = 16000

export type VoiceEvents = {
  onUserTranscript?: (text: string) => void
  onAgentResponse?: (text: string) => void
  onError?: (reason: string) => void
}

export function useVoice(events: VoiceEvents) {
  const [state, setState] = useState<VoiceState>('idle')
  const [available, setAvailable] = useState<boolean | null>(null)
  /*
   * WHY it is unavailable, in the operator's words. Hiding the button silently would leave
   * somebody who expects to talk to Thomas wondering whether the feature exists, was removed, or
   * is broken. A stated reason costs one line and answers all three.
   */
  const [reason, setReason] = useState<string | null>(null)

  const ws = useRef<WebSocket | null>(null)
  const ctx = useRef<AudioContext | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const node = useRef<ScriptProcessorNode | null>(null)
  const source = useRef<MediaStreamAudioSourceNode | null>(null)
  /* Playback is a scheduled queue, not fire-and-forget: overlapping chunks sound like two people. */
  const playAt = useRef(0)
  const playing = useRef<AudioBufferSourceNode[]>([])
  const evt = useRef(events)
  evt.current = events

  /** Probe whether voice can actually WORK before showing a control that cannot play. */
  useEffect(() => {
    let alive = true
    fetch('/api/thomas/voice', { method: 'GET' })
      .then(async (r) => {
        const verdict = await readMint(r)
        if (!alive) return
        setAvailable(verdict.ok)
        if (!verdict.ok) setReason(verdict.reason)
      })
      .catch(() => {
        if (!alive) return
        setAvailable(false)
        setReason('Voice could not be reached from this browser.')
      })
    return () => {
      alive = false
    }
  }, [])

  const teardown = useCallback(() => {
    try { ws.current?.close() } catch {}
    ws.current = null
    try { node.current?.disconnect() } catch {}
    try { source.current?.disconnect() } catch {}
    node.current = null
    source.current = null
    // Release the microphone. Every track, explicitly, so no browser keeps the indicator lit.
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    playing.current.forEach((s) => { try { s.stop() } catch {} })
    playing.current = []
    playAt.current = 0
    try { ctx.current?.close() } catch {}
    ctx.current = null
    setState('idle')
  }, [])

  useEffect(() => () => teardown(), [teardown])

  const start = useCallback(
    async (dynamicVariables: Record<string, string>) => {
      if (ws.current) return
      setState('connecting')
      try {
        const minted = await readMint(await fetch('/api/thomas/voice'))
        if (!minted.ok) throw new Error(minted.reason)

        // Ask BEFORE opening the socket, so a refused microphone never leaves a live session open.
        const media = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        stream.current = media

        const audio = new AudioContext({ sampleRate: SAMPLE_RATE })
        ctx.current = audio
        if (audio.state === 'suspended') await audio.resume()

        const socket = new WebSocket(minted.signedUrl)
        ws.current = socket

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: 'conversation_initiation_client_data',
              dynamic_variables: dynamicVariables,
            }),
          )
          const src = audio.createMediaStreamSource(media)
          source.current = src
          /*
           * ScriptProcessor is deprecated in favour of AudioWorklet, and it is still the right call
           * here: a worklet needs a separate module file fetched at runtime, and this runs inside a
           * gated app where that is one more thing to route and cache-bust. The processing is a
           * float-to-int16 conversion, which is cheap enough that the main-thread cost is not
           * audible. If it ever is, the upgrade is local to this file.
           */
          const proc = audio.createScriptProcessor(4096, 1, 1)
          node.current = proc
          proc.onaudioprocess = (e) => {
            if (socket.readyState !== WebSocket.OPEN) return
            const input = e.inputBuffer.getChannelData(0)
            const pcm = new Int16Array(input.length)
            for (let i = 0; i < input.length; i += 1) {
              // `?? 0` satisfies noUncheckedIndexedAccess. The index cannot actually be out of
              // range here, and silence is the correct value if it ever were.
              const s = Math.max(-1, Math.min(1, input[i] ?? 0))
              pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
            }
            socket.send(JSON.stringify({ user_audio_chunk: toBase64(pcm.buffer) }))
          }
          src.connect(proc)
          // Zero-gain sink: a ScriptProcessor does not fire unless it is connected to a destination,
          // and routing it at full gain would play the operator's own microphone back at them.
          const mute = audio.createGain()
          mute.gain.value = 0
          proc.connect(mute)
          mute.connect(audio.destination)
          setState('listening')
        }

        socket.onmessage = (e) => {
          let msg: Record<string, unknown>
          try {
            msg = JSON.parse(typeof e.data === 'string' ? e.data : '{}')
          } catch {
            return
          }
          const type = String(msg.type ?? '')
          if (type === 'ping') {
            const id = (msg.ping_event as { event_id?: number } | undefined)?.event_id
            socket.send(JSON.stringify({ type: 'pong', event_id: id }))
          } else if (type === 'audio') {
            const b64 = (msg.audio_event as { audio_base_64?: string } | undefined)?.audio_base_64
            if (b64 && ctx.current) enqueue(b64)
          } else if (type === 'user_transcript') {
            const t = (msg.user_transcription_event as { user_transcript?: string } | undefined)?.user_transcript
            if (t) evt.current.onUserTranscript?.(t)
          } else if (type === 'agent_response') {
            const t = (msg.agent_response_event as { agent_response?: string } | undefined)?.agent_response
            if (t) evt.current.onAgentResponse?.(t)
          } else if (type === 'interruption') {
            // The operator started talking. Stop mid-word; finishing the sentence is what makes an
            // agent feel like it is not listening.
            playing.current.forEach((s) => { try { s.stop() } catch {} })
            playing.current = []
            playAt.current = 0
            setState('listening')
          }
        }

        socket.onerror = () => {
          evt.current.onError?.('The voice connection dropped.')
          setState('error')
        }
        socket.onclose = () => {
          if (ws.current) teardown()
        }
      } catch (err) {
        teardown()
        const reason = err instanceof Error ? err.message : 'Voice could not start.'
        evt.current.onError?.(reason)
        setState('error')
      }
    },
    [teardown],
  )

  /** Decode a chunk of agent speech and schedule it after whatever is already queued. */
  function enqueue(b64: string) {
    const audio = ctx.current
    if (!audio) return
    const bytes = fromBase64(b64)
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    const buf = audio.createBuffer(1, pcm.length, SAMPLE_RATE)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i += 1) ch[i] = (pcm[i] ?? 0) / 0x8000
    const src = audio.createBufferSource()
    src.buffer = buf
    src.connect(audio.destination)
    const now = audio.currentTime
    // Never schedule in the past: a late chunk would otherwise play instantly and overlap the one
    // still sounding, which is heard as a stutter rather than as a delay.
    const at = Math.max(now, playAt.current)
    src.start(at)
    playAt.current = at + buf.duration
    playing.current.push(src)
    src.onended = () => {
      playing.current = playing.current.filter((s) => s !== src)
      if (!playing.current.length && ws.current) setState('listening')
    }
    setState('speaking')
  }

  const stop = useCallback(() => teardown(), [teardown])

  return { state, available, reason, start, stop }
}

/**
 * READ THE MINT RESPONSE, OR SAY WHY IT COULD NOT BE READ.
 *
 * ==========================================================================================
 * THE DEFECT THIS ENDS IS ABOUT THE SENTENCE THE OPERATOR GETS, NOT ABOUT ACCESS.
 * ==========================================================================================
 * Both call sites used to go straight to `r.json()`. That is not a fail-open: when the gate has
 * expired, `proxy.ts` answers this route with a 307 to `/enter`, fetch follows it, and the body is
 * the sign-in PAGE. `json()` throws on the leading `<`, the throw is caught, and the code denies.
 * Access was never granted at any point. What the person got was the wrong explanation, or none:
 *
 *   - `start()` surfaced the raw parse error, so pressing Talk produced something like
 *     "Unexpected token '<'", which tells a trader nothing and looks like the product is broken.
 *   - the probe was worse, and it is the reason `r.redirected` is checked FIRST here rather than
 *     `r.ok`. A followed redirect answers 200, so `r.ok` was TRUE, the probe set `available` to
 *     true, and the Talk button rendered on a session that cannot mint. That is this estate's named
 *     defect of a media control that renders and cannot play, arriving through the back door.
 *
 * So the response is inspected in the order the failures actually occur: bounced to sign-in first,
 * then a body that is not JSON at all, then a stated refusal from the route, and only then the shape
 * of what came back. Every branch answers with a sentence somebody can act on.
 *
 * THE CONTENT TYPE IS ASSERTED, NOT JUST THE REDIRECT, and that is the stronger of the two checks.
 * `r.redirected` catches the bounce we know about. A proxy that rewrites in place, or any future
 * layer that answers 200 with an HTML error page and no redirect at all, defeats it and would put
 * us straight back to parsing markup as a mint. Asking what the body actually IS closes both, and
 * it is the proof the repository's own `followed-redirect-read-as-ok` lint gate asks for.
 *
 * The two `fetch` calls in `app/api/thomas/voice/route.ts` are NOT this defect and must not be
 * "fixed" the same way. They are server-to-server calls to api.elevenlabs.io, where `.ok` is already
 * checked, there is no gate in front of them, and there is no redirect to follow.
 */
export type MintVerdict = { ok: true; signedUrl: string } | { ok: false; reason: string }

/*
 * EXPORTED FOR ONE REASON: so `test/thomas/voice-mint.test.ts` can hand it the four responses this
 * route really produces, including the sign-in PAGE that a bounced session returns. There is no DOM
 * test harness in this repository, so the alternative was to leave the branch that decides whether
 * the Talk button appears untested, which is the branch that shipped the defect.
 */
export async function readMint(r: Response): Promise<MintVerdict> {
  if (r.redirected) {
    return {
      ok: false,
      reason: 'Your session expired, so voice could not start. Sign in again, then reopen this panel.',
    }
  }

  if (!(r.headers.get('content-type') ?? '').includes('application/json')) {
    /*
     * Not JSON, so this is not our route answering. The overwhelmingly likely cause is the gate
     * handing back a sign-in page, so the operator is told the useful thing rather than the
     * literal one. It is stated as the probable cause, never as a certainty.
     */
    return {
      ok: false,
      reason:
        r.status === 200
          ? 'Voice answered with a page instead of a session, which usually means your sign in expired. Sign in again, then reopen this panel.'
          : `Voice could not start (${r.status}).`,
    }
  }

  const body = (await r.json().catch(() => null)) as
    | { ok?: boolean; signedUrl?: string; message?: string }
    | null

  if (!r.ok) {
    return { ok: false, reason: body?.message ?? `Voice could not start (${r.status}).` }
  }
  if (!body) {
    return { ok: false, reason: 'Voice answered with something this browser could not read.' }
  }
  if (body.ok !== true || typeof body.signedUrl !== 'string' || !body.signedUrl) {
    return { ok: false, reason: body.message ?? 'Voice is not connected here.' }
  }
  return { ok: true, signedUrl: body.signedUrl }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  // Chunked, because spreading a large array into String.fromCharCode overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}
