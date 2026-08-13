import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ONLYSOURCE',
  description: 'Operator workspace for defense parts dealers.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never block a user from zooming. Some of the people who use this are in their seventies.
  maximumScale: 5,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * data-theme="dark" IS THE DEFAULT, AND IT IS LOAD-BEARING.
     *
     * MEASURED, not assumed: without it, a browser reporting prefers-color-scheme light OR
     * no-preference renders --bg #fbfbf8 and a light product. Only a machine already set to
     * dark saw the console David approved. Most machines are not set to dark, so most
     * people would have opened ONLYSOURCE and seen a design nobody signed off.
     *
     * @T8's tokens are correct and unchanged; their own comment states that an explicit
     * data-theme wins in both directions, which is exactly what this uses. Setting it here
     * makes the shipped default match the ruling (dark is the default theme) while leaving
     * their light theme fully intact for the moment a user preference exists to select it.
     *
     * When per-user display preferences land, this attribute is read from the preference
     * and "system" becomes a third option that simply omits it.
     */
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  )
}
