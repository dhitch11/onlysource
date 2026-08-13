import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_APP_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    // No session replay. This is a workspace for export-controlled procurement work and a
    // replay is a recording of a drawing somebody was allowed to see and we were not.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
