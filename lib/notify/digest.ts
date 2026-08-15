import type { Signal } from './signals'

/**
 * THE ALERT DIGEST — the signal set rendered into a premium, plain-language email.
 *
 * Same words the in-app centre shows, laid out for the inbox: one clear subject that says what needs
 * attention, then each signal with its title, a sentence a non-engineer understands, and a button
 * into the exact surface. Dark, on-brand, and it renders in every mail client because it is inlined
 * tables and inline styles. Text part mirrors it for clients that strip HTML.
 */

const BASE = process.env.ONLYSOURCE_PUBLIC_URL || 'https://206.189.230.237.nip.io'
const BRASS = '#cbab6c'
const INK = '#eaede4'
const DIM = '#98a18f'
const BG = '#0a0d0b'
const PANEL = '#101410'
const LINE = 'rgba(190,205,185,0.14)'

const SEV_LABEL: Record<Signal['severity'], string> = { high: 'Act now', medium: 'Worth an hour', info: 'Good to know' }

export function digestSubject(signals: Signal[], feedDay: string | null): string {
  const highs = signals.filter((s) => s.severity === 'high').length
  const day = feedDay ? ` (${feedDay})` : ''
  if (highs > 0) return `ONLYSOURCE: ${highs} thing${highs === 1 ? '' : 's'} to act on today${day}`
  return `ONLYSOURCE: ${signals.length} signal${signals.length === 1 ? '' : 's'} for you${day}`
}

export function digestHtml(signals: Signal[], feedDay: string | null): string {
  const rows = signals
    .map(
      (s) => `
      <tr><td style="padding:0 0 14px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL};border:1px solid ${LINE};border-radius:12px">
          <tr><td style="padding:18px 20px">
            <div style="font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${BRASS};margin:0 0 8px">${SEV_LABEL[s.severity]}</div>
            <div style="font:650 16px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK};margin:0 0 6px">${escapeHtml(s.title)}</div>
            <div style="font:400 14px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:${DIM};margin:0 0 14px">${escapeHtml(s.body)}</div>
            <a href="${BASE}${s.href}" style="display:inline-block;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a1509;background:${BRASS};padding:10px 16px;border-radius:8px;text-decoration:none">Open it &rarr;</a>
          </td></tr>
        </table>
      </td></tr>`,
    )
    .join('')

  return `<!doctype html><html><body style="margin:0;background:${BG};padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
        <tr><td style="padding:0 4px 20px">
          <div style="font:700 20px/1 -apple-system,Segoe UI,Roboto,sans-serif;color:${INK}">ONLY<span style="color:${BRASS}">SOURCE</span></div>
          <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${DIM};margin-top:6px">Your signals for ${feedDay ? escapeHtml(feedDay) : 'today'}. Every number here is measured from the live government feed.</div>
        </td></tr>
        ${rows}
        <tr><td style="padding:8px 4px 0">
          <div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:${DIM}">You are getting this because alerts are on. Change what pings you in <a href="${BASE}/settings" style="color:${BRASS}">Settings</a>.</div>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`
}

export function digestText(signals: Signal[], feedDay: string | null): string {
  const head = `ONLYSOURCE signals for ${feedDay ?? 'today'}\nEvery number is measured from the live government feed.\n`
  const body = signals
    .map((s) => `\n[${SEV_LABEL[s.severity]}] ${s.title}\n${s.body}\nOpen: ${BASE}${s.href}`)
    .join('\n')
  return `${head}${body}\n\nChange what pings you: ${BASE}/settings`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
