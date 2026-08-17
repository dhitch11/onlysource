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

  /** Probe whether voice is configured before showing a control that cannot connect. */
  useEffect(() => {
    let alive = true
    fetch('/api/thomas/voice', { method: 'GET' })
      .then((r) => setAvailable(alive ? r.ok : false))
      .catch(() => alive && setAvailable(false))
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
        const minted = await fetch('/api/thomas/voice').then((r) => r.json())
        if (!minted?.ok || !minted.signedUrl) throw new Error(minted?.message || 'Voice is not connected here.')

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

  return { state, available, start, stop }
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
