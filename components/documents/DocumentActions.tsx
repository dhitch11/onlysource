'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import s from './document-actions.module.css'

/**
 * THE TWO AFFORDANCES THAT TURN A SCREEN INTO A DELIVERABLE. Owner: the DOCUMENTS lane.
 *
 * =====================================================================================================
 * WHY THE BYTES ARE BUILT ON THE SERVER AND ONLY WRAPPED HERE.
 * =====================================================================================================
 * House law 2 says deterministic code owns every number, and a browser is not where a federal document
 * gets composed. So `content` arrives already finished, from the pure composer in
 * lib/compliance/deliverables/document-file.ts, and this component's entire job is to hand those exact
 * bytes to the browser's save dialog. It does not format, truncate, re-wrap or interpolate anything.
 * If this file ever grows a template literal with a figure in it, that is the defect.
 *
 * =====================================================================================================
 * A DOWNLOAD THAT SILENTLY DID NOTHING WOULD BE THE WORST VERSION OF THIS CONTROL.
 * =====================================================================================================
 * The operator presses Download, nothing appears, and they conclude the packet is on their disk. So
 * the anchor click is wrapped and any failure renders a sentence a person reads, in the same place the
 * button is, rather than a console error nobody sees. The object URL is revoked on the next frame
 * rather than immediately, because revoking in the same tick cancels the navigation the click just
 * started in more than one browser.
 */

export function DownloadFileButton(props: {
  filename: string
  mediaType: string
  content: string
  label: string
  variant?: 'primary' | 'secondary'
  /** Rendered under the button. Says what the file contains, before it is opened. */
  description?: string
}) {
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function download() {
    setProblem(null)
    try {
      const blob = new Blob([props.content], { type: props.mediaType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = props.filename
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Next frame, not this one. Revoking synchronously cancels the save in some browsers.
      requestAnimationFrame(() => URL.revokeObjectURL(url))
      setSaved(true)
    } catch (e) {
      setSaved(false)
      setProblem(
        'This browser refused to save the file, so nothing was written to your disk. ' +
          (e instanceof Error ? e.message : 'No reason was given.') +
          ' Use Print instead, and choose save as PDF.',
      )
    }
  }

  return (
    <div className={s.action}>
      <Button type="button" variant={props.variant ?? 'secondary'} onClick={download}>
        {props.label}
      </Button>
      {props.description ? <p className={s.note}>{props.description}</p> : null}
      <p className={s.file}>
        <span className="mono">{props.filename}</span>, {props.content.length.toLocaleString()} characters
      </p>
      {problem ? (
        <p className="banner banner--danger" role="alert">
          {problem}
        </p>
      ) : null}
      {saved && problem === null ? (
        <p className={s.note} role="status">
          The browser was handed the file. Where it landed is your browser&rsquo;s download setting, not
          something this product can see.
        </p>
      ) : null}
    </div>
  )
}

/**
 * PRINT. A real stylesheet on real letter paper, not a screenshot of a dark interface.
 *
 * The print rules live in documents.module.css beside the layout they reorganise. This button only
 * opens the dialog, and it says what will come out before it does, because a print job is the one
 * action on this page that costs paper.
 */
export function PrintButton(props: { label: string; description: string }) {
  return (
    <div className={s.action}>
      <Button type="button" variant="secondary" onClick={() => window.print()}>
        {props.label}
      </Button>
      <p className={s.note}>{props.description}</p>
    </div>
  )
}
