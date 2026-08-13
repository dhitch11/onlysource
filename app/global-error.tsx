'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

/**
 * The last resort, used when the root layout itself failed. It must render its own html and
 * body and must not depend on the stylesheet, because the failure may be the stylesheet.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '32px 16px',
          fontFamily: 'system-ui, sans-serif',
          color: '#12161d',
          background: '#ffffff',
          lineHeight: 1.5,
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: '0 0 8px' }}>ONLYSOURCE failed to start.</h1>
        <p style={{ margin: '0 0 8px', maxWidth: '60ch' }}>
          The application could not render at all. This is our fault. Reload the page, and if it
          keeps happening send the reference below to the build team.
        </p>
        {error.digest ? (
          <p style={{ fontFamily: 'ui-monospace, monospace' }}>Reference {error.digest}</p>
        ) : null}
      </body>
    </html>
  )
}
