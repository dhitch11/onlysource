import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SignalKind } from './signals'

/**
 * ALERT SETTINGS — which signals reach the operator, and on which channel.
 *
 * A real CRM lets you decide what pings you. This is that control, stored server-side so the email
 * scheduler and the in-app centre both obey the same choices. One JSON file in a state directory that
 * survives deploys (it is gitignored and never in the repo). Missing or malformed file falls back to
 * a sensible default rather than failing, and unknown keys are ignored so an old file never breaks a
 * new deploy.
 */

export type ChannelPrefs = { inApp: boolean; email: boolean }
export type AlertSettings = {
  /** Master switches. Turning a channel off here silences it regardless of per-kind choices. */
  master: ChannelPrefs
  /** Where alert emails go. */
  emailRecipient: string
  /** Per-signal-kind channel choices. */
  perKind: Record<SignalKind, ChannelPrefs>
}

const ALL_KINDS: SignalKind[] = ['award_clock', 'perfect_storm', 'no_quote', 'escalation', 'forecast']

export const DEFAULT_SETTINGS: AlertSettings = {
  master: { inApp: true, email: true },
  emailRecipient: 'david@reddenda.com',
  perKind: {
    award_clock: { inApp: true, email: true },
    perfect_storm: { inApp: true, email: true },
    no_quote: { inApp: true, email: true },
    escalation: { inApp: true, email: false },
    forecast: { inApp: true, email: false },
  },
}

function stateDir(): string {
  return process.env.ONLYSOURCE_STATE_DIR || path.join(process.cwd(), '.state')
}
function settingsPath(): string {
  return path.join(stateDir(), 'alert-settings.json')
}

function coerce(raw: unknown): AlertSettings {
  const d = DEFAULT_SETTINGS
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<AlertSettings>
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  const perKind = {} as Record<SignalKind, ChannelPrefs>
  for (const k of ALL_KINDS) {
    const src = r.perKind?.[k]
    perKind[k] = {
      inApp: bool(src?.inApp, d.perKind[k].inApp),
      email: bool(src?.email, d.perKind[k].email),
    }
  }
  return {
    master: {
      inApp: bool(r.master?.inApp, d.master.inApp),
      email: bool(r.master?.email, d.master.email),
    },
    emailRecipient:
      typeof r.emailRecipient === 'string' && r.emailRecipient.includes('@')
        ? r.emailRecipient
        : d.emailRecipient,
    perKind,
  }
}

export function readSettings(): AlertSettings {
  try {
    const p = settingsPath()
    if (!existsSync(p)) return DEFAULT_SETTINGS
    return coerce(JSON.parse(readFileSync(p, 'utf8')))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function writeSettings(next: AlertSettings): AlertSettings {
  const settings = coerce(next)
  const dir = stateDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  return settings
}

/** Does this kind reach the given channel, honouring both the master switch and the per-kind choice? */
export function channelEnabled(s: AlertSettings, kind: SignalKind, channel: keyof ChannelPrefs): boolean {
  return s.master[channel] && s.perKind[kind][channel]
}
