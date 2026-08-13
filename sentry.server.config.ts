import * as Sentry from '@sentry/nextjs'

/**
 * Sentry, server runtime.
 *
 * With no DSN this initialises nothing at all rather than initialising a client that
 * silently drops events. `/api/health` reports `error_tracking: not_configured` so an
 * absent plug is a stated fact and never reads as coverage we do not have.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Never ship request bodies or headers to a third party by default. This product's
    // payloads carry contracted prices and government identifiers.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
        delete event.request.data
      }
      return event
    },
  })
}
