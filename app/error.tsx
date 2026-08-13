'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

/**
 * A designed error state.
 *
 * It does NOT print the exception. A stack or a message can carry a connection string or a
 * value from the input that produced it, and this page is rendered to a person who cannot
 * act on either. The digest is shown because it is the one token that lets somebody find
 * this exact occurrence in the logs.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="entry">
      <div className="entry__panel stack stack--tight">
        <p className="h1">Something failed on our side.</p>
        <p className="lede">
          This is our fault, not yours, and nothing you were doing was lost by loading this
          page. Try again. If it keeps happening, send the reference below to the build team.
        </p>
        {error.digest ? (
          <p className="banner banner--notice">
            <span>
              Reference <span className="mono">{error.digest}</span>
            </span>
          </p>
        ) : null}
        <p>
          <button className="button" type="button" onClick={reset}>
            Try again
          </button>
        </p>
      </div>
    </main>
  )
}
