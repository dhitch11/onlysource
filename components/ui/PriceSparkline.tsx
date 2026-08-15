import * as React from 'react'

/**
 * PRICE SPARKLINE — the monopoly forming, drawn from real award prices.
 *
 * Every point is a government-paid unit price on one stock number, in award order. Nothing is
 * interpolated to fill a gap and nothing is invented: the caller passes the measured series and
 * this draws exactly those points. Two or more points draw a trajectory; one point draws a single
 * dot; zero points render nothing, because a sparkline of no data would be a fabricated line.
 *
 * Colour is brass (--accent), never amber/red. On this product a rising price is pricing power on a
 * cornered part, not a deadline; amber and red are reserved for the award clock alone (tokens.css).
 *
 * Pure SVG, no client JavaScript. It renders on the server inside a grid cell or a detail header.
 */
export type PriceSparklineProps = {
  /** Measured unit prices in chronological award order. */
  points: number[]
  width?: number
  height?: number
  /** Accessible description; the caller knows the item, so it supplies the sentence. */
  ariaLabel: string
  /** Draw the filled area under the line. Off for the tiniest inline use. */
  area?: boolean
  className?: string
}

export function PriceSparkline({
  points,
  width = 104,
  height = 28,
  ariaLabel,
  area = true,
  className,
}: PriceSparklineProps) {
  const clean = points.filter((p) => Number.isFinite(p))
  if (clean.length === 0) return null

  const padX = 3
  const padY = 4
  const w = width
  const h = height
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min

  const x = (i: number) =>
    clean.length === 1 ? w / 2 : padX + (i / (clean.length - 1)) * (w - padX * 2)
  // Flat series sit on the mid-line rather than pinning to an edge, so "no change" reads as level.
  const y = (v: number) =>
    span === 0 ? h / 2 : padY + (1 - (v - min) / span) * (h - padY * 2)

  const last = clean[clean.length - 1] as number
  const lastX = x(clean.length - 1)
  const lastY = y(last)

  if (clean.length === 1) {
    return (
      <svg
        className={className}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={ariaLabel}
      >
        <circle cx={w / 2} cy={h / 2} r={3} fill="var(--accent)" />
      </svg>
    )
  }

  const line = clean.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(' ')
  const fill = `${line} L ${lastX.toFixed(2)} ${(h - padY).toFixed(2)} L ${x(0).toFixed(2)} ${(h - padY).toFixed(2)} Z`

  return (
    <svg
      className={className}
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {area ? <path d={fill} fill="var(--accent-soft)" stroke="none" /> : null}
      <path
        d={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={2.75} fill="var(--accent)" />
    </svg>
  )
}
