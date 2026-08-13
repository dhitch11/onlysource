import Link from 'next/link'

/**
 * A designed not-found state. A default browser error page is a defect, not a placeholder.
 * It says what happened, what it does NOT mean, and gives one obvious way forward.
 */
export default function NotFound() {
  return (
    <main className="entry">
      <div className="entry__panel stack stack--tight">
        <p className="h1">That page does not exist here.</p>
        <p className="lede">
          Either the address is wrong, or it belongs to part of the product that is not built
          yet. It does not mean you lack permission, and nothing has gone wrong with your
          session.
        </p>
        <p>
          <Link href="/">Go to the workspace</Link>
        </p>
      </div>
    </main>
  )
}
