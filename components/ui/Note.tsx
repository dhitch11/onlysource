import styles from './Note.module.css'

/**
 * <Note /> — a short line a person actually reads, with the full detail one obvious click away.
 *
 * ==========================================================================================
 * WHY THIS EXISTS. MEASURED, NOT FELT.
 * ==========================================================================================
 * Prose words rendered outside the grid, per page:
 *
 *     /competitor  1,004 words, 11 paragraphs over 40 words
 *     /goldmine      623
 *     /monopoly      546, THREE paragraphs over 80 words, longest 114
 *     /intelligence  407, longest 114
 *     /pricing       261, longest 101
 *     /board         248, longest 154
 *
 * A 154-word paragraph on a dashboard is not read. It is skipped, and everything in it is lost —
 * including the part that makes the number above it trustworthy, which is the whole reason it was
 * written.
 *
 * ★ THE CONTENT IS NOT THE PROBLEM AND IS NOT CUT. Every word of these notes is doing real work:
 * they say what a figure is counted from, what is excluded, and what the product does not know.
 * Deleting them to make the screen shorter would trade the product's credibility for whitespace.
 * What changes is that the reader gets the OPERATIVE SENTENCE first and chooses whether to read
 * the method.
 *
 * ==========================================================================================
 * WHY NATIVE <details>, AND NOT A useState TOGGLE.
 * ==========================================================================================
 * It is keyboard operable, screen-reader announced, and findable by the browser's own Ctrl+F
 * (Chrome expands a closed <details> to reveal a match) without a line of JavaScript. It also
 * renders open-able in a server component, which is where every one of these notes lives.
 *
 * A hand-rolled toggle would have to re-earn all four, and the third one matters here: an
 * operator searching the page for a figure must not be told it is absent because it was behind a
 * div nobody told the browser about.
 *
 * ==========================================================================================
 * THE AFFORDANCE IS THE POINT.
 * ==========================================================================================
 * A disclosure nobody notices is worse than no disclosure, because the detail is now hidden AND
 * unreachable. So the control says a word ("How this is counted"), carries a chevron that turns,
 * and gets hover, focus-visible and open states. It never relies on the chevron alone.
 */
/**
 * Split a composed statement into its sentences.
 *
 * Several provenance strings in this product are built as `parts.join(' ')` — independent
 * sentences fused into one field — and then rendered as a single 114-word paragraph. Splitting
 * at the RENDER site lets those become a lead plus a disclosure without changing a shared data
 * shape that other consumers and tests depend on.
 *
 * ★ THE LOOKAHEAD IS LOAD-BEARING. A naive split on '. ' cuts "1,999. so" correctly but also
 * cuts inside "sha256 7f8a6a6c." and any decimal that happens to precede a space. Requiring the
 * next character to be an uppercase letter or a digit-led date keeps every real boundary in this
 * corpus and invents none. If it ever fails to split, the whole string becomes the lead — which
 * is the old behaviour, so the failure mode is "no improvement", never "text lost".
 */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.:;])\s+(?=[A-Z])/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/**
 * A <Note> built from one composed string: first sentence leads, the rest expands.
 *
 * Falls back to rendering the whole thing as the lead with no disclosure when there is only one
 * sentence, because a disclosure that opens onto nothing is worse than no control.
 */
export function TextNote({
  text,
  label,
  tone,
}: {
  readonly text: string
  readonly label?: string
  readonly tone?: 'default' | 'quiet'
}) {
  const parts = sentences(text)
  if (parts.length <= 1) return <p className={styles.single}>{text}</p>
  return (
    <Note lead={parts[0]} label={label} tone={tone}>
      {parts.slice(1).map((s, i) => (
        <p key={i}>{s}</p>
      ))}
    </Note>
  )
}

export function Note({
  lead,
  label = 'How this is counted',
  children,
  tone = 'default',
}: {
  /** The sentence a reader gets whether or not they open anything. Say the operative fact. */
  readonly lead: React.ReactNode
  /** What the detail IS, in the operator's words. Never "More" — say what opens. */
  readonly label?: string
  /** The full detail. Every word that used to be in the wall belongs here. */
  readonly children: React.ReactNode
  /** `quiet` for a note under a figure; `default` for a standalone band. */
  readonly tone?: 'default' | 'quiet'
}) {
  return (
    <details className={`${styles.note} ${tone === 'quiet' ? styles.quiet : ''}`}>
      <summary className={styles.summary}>
        <span className={styles.lead}>{lead}</span>
        <span className={styles.toggle}>
          <span className={styles.toggleText}>{label}</span>
          <svg className={styles.chev} viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
