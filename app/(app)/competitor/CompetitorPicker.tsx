'use client'

import { useRouter } from 'next/navigation'
import styles from './competitor.module.css'

/** Choose which company to tear down. Navigates to ?cage=… so the page stays server-rendered. */
export function CompetitorPicker({
  options,
  current,
}: {
  options: Array<{ cage: string; label: string; parts: number; deep: boolean }>
  current: string
}) {
  const router = useRouter()
  return (
    <label className={styles.pickerLabel}>
      <span className={styles.pickerText}>Tear down</span>
      <select
        className={styles.picker}
        value={current}
        onChange={(e) => router.push(`/competitor?cage=${encodeURIComponent(e.target.value)}`)}
      >
        {options.map((o) => (
          <option key={o.cage} value={o.cage}>
            {o.label} · {o.parts} reference {o.parts === 1 ? 'row' : 'rows'}
            {o.deep ? ' · dedicated pull' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
