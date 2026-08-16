import type { Metadata } from 'next'
import { requireGateSession } from '@/lib/session/require-gate'
import { readSettings } from '@/lib/notify/settings'
import { emailConfigured, sendPreflight } from '@/lib/notify/email'
import { SIGNAL_KINDS } from '@/lib/notify/signals'
import { SettingsForm } from './SettingsForm'
import styles from './settings.module.css'

export const metadata: Metadata = { title: 'Settings · ONLYSOURCE' }
export const dynamic = 'force-dynamic'

/**
 * SETTINGS — what pings you, and how.
 *
 * The real CRM control: for each kind of signal, choose whether it shows up in the app, emails you,
 * or both. Master switches silence a whole channel. Changes save server-side so the email scheduler
 * and the in-app bell both obey them. When email is not connected in this environment, the page says
 * so plainly instead of pretending the email toggles do something.
 */
export default async function SettingsPage() {
  await requireGateSession('/settings')
  const settings = readSettings()
  // The channel's standing state, computed server-side so the page can say "disarmed"
  // BEFORE the operator spends a click on a test. sendPreflight exists for exactly this.
  const pf = sendPreflight(settings.emailRecipient)

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Settings</p>
        <h1 className={styles.h1}>Alerts &amp; notifications</h1>
        <p className={styles.sub}>
          Choose what pings you and how. Turn a whole channel off at the top, or pick channels for each
          kind of signal below. Changes save the moment you make them.
        </p>
      </header>
      <SettingsForm
        initial={settings}
        kinds={SIGNAL_KINDS}
        emailConfigured={emailConfigured()}
        channelState={{ wouldSend: pf.wouldSend, reason: pf.reason }}
      />
    </main>
  )
}
