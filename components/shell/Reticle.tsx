/*
 * <Reticle /> THE MARK. Owner: T8 DESIGN.
 *
 * The brass targeting reticle: two concentric rings, four tick marks at the cardinals, a
 * solid brass centre dot. Geometry is taken verbatim from the approved console mockup's
 * `.reticle`, which is the locked logo.
 *
 * THE OLD BOXED "O" IS DEAD. It is retired by the BUILD-DIRECTIVE. Do not ship it anywhere.
 *
 * IT IS IDENTICAL ON EVERY SURFACE: sidebar, print header, PDF export, email. That is the
 * canonical-logo house law, and it is why this is one component rendering inline SVG rather
 * than an asset that can drift between a favicon, a header and a document template.
 *
 * WHY INLINE SVG AND NOT AN IMAGE FILE
 * It inherits currentColor, so it is correct in both themes without a second asset. It has
 * no network cost and cannot produce a broken-image box on a page that must never look
 * broken. And a media element must never render a control that cannot paint.
 *
 * The drop shadow is deliberately NOT applied here. A filter on an inline SVG costs a
 * compositing layer on every row of a twenty-thousand-row grid if this ever ends up inside
 * one. The brand lockup in the sidebar applies it in CSS, once.
 */

export interface ReticleProps {
  /** Rendered size in px. The geometry is a 40-unit viewBox and scales cleanly. */
  size?: number;
  /** Decorative in the brand lockup, where the wordmark next to it already says the name.
   *  Set a title only where the mark stands alone. */
  title?: string;
  className?: string;
}

export function Reticle({ size = 32, title, className }: ReticleProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* Outer ring */}
      <circle cx="20" cy="20" r="14.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {/* Inner ring, one step darker so the mark has depth at 16px as well as at 32px */}
      <circle cx="20" cy="20" r="8.5" fill="none" stroke="var(--accent-2)" strokeWidth="1.5" />
      {/* Four cardinal ticks */}
      <line x1="20" y1="1.5" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="20" y1="32" x2="20" y2="38.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1.5" y1="20" x2="8" y2="20" stroke="currentColor" strokeWidth="1.5" />
      <line x1="32" y1="20" x2="38.5" y2="20" stroke="currentColor" strokeWidth="1.5" />
      {/* Centre dot, solid */}
      <circle cx="20" cy="20" r="3.2" fill="currentColor" />
    </svg>
  );
}
