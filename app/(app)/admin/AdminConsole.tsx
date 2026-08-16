'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { ExplainButton } from '@/components/ui/ExplainButton'
import type { DirectoryUser, RoleOption } from '@/lib/admin/directory'
import styles from './Admin.module.css'

/**
 * THE ROSTER CONSOLE. The operator's real, persisted user list.
 *
 * ==========================================================================================
 * THIS COMPONENT DECIDES NOTHING. That is the design, not a limitation.
 * ==========================================================================================
 * Every "may this be done" question was answered on the server by `lib/admin/roster-rules`
 * and arrives on each row as `actions.<verb>.{allowed, reason}`. This file renders those
 * verdicts and nothing more. It never re-implements a rule, so it cannot drift from the one
 * the API enforces, and the sentence under a disabled control is the same string the API
 * would have refused with.
 *
 * After every write the server returns the WHOLE recomputed roster and this component
 * replaces its state with it. So a change that shifts what is allowed elsewhere (promoting a
 * second owner, which unlocks the first owner's controls) updates every affected row at once,
 * without this file knowing why.
 *
 * ==========================================================================================
 * A FOLLOWED REDIRECT IS NOT A SUCCESS. This is the defect this file exists to not have.
 * ==========================================================================================
 * When the gate cookie expires, `proxy.ts` answers an /api/* request with a 307 to /enter,
 * `fetch` FOLLOWS it, and /enter answers 200 with HTML. So `response.ok` is TRUE on a request
 * that saved nothing. Measured, on a real page with the cookie jar cleared:
 * `{ok: true, status: 200, redirected: true, endedAt: "/enter?next=%2Fapi%2Fadmin%2Fusers"}`.
 * A client that only checks `!r.ok` clears its form and says nothing, and the operator walks
 * away believing an account was deactivated. `send()` therefore requires the PAYLOAD, not the
 * status: no `users` array means no save, whatever the status line claims.
 *
 * FOUR SMALLER THINGS THAT MATTER MORE THAN THEY LOOK:
 *
 *  - A failed request renders its message. Silence after a click reads as "it worked".
 *  - A control that can never work is DISABLED, not hidden, with the reason in visible text.
 *    Hiding it leaves an operator wondering whether they lack the permission or the product
 *    lacks the feature. That is the ruling this screen already followed and it still holds.
 *  - Removal is two clicks, in place. No `confirm()` dialog: a modal browser dialog blocks
 *    the page and, in this environment, the automation that verifies the page.
 *  - There is no optimistic update on a mutation the server can refuse. The row shows busy,
 *    then shows what the server actually stored. Optimism here would flash a role the
 *    operator does not have.
 */

type Draft = { name: string; email: string; title: string; roleKey: string }

const emptyDraft = (roleKey: string): Draft => ({ name: '', email: '', title: '', roleKey })

const SESSION_GONE =
  'This session is no longer signed in, so nothing was saved. Reload the page and enter the ' +
  'access phrase again.'

export function AdminConsole({
  initial,
  roleOptions,
  accessNote,
  canMutate,
  mutateBlockedReason,
}: {
  initial: DirectoryUser[]
  roleOptions: RoleOption[]
  accessNote: string
  /** Measured, not assumed: whether the server can actually write the roster file. */
  canMutate: boolean
  mutateBlockedReason: string | null
}) {
  const defaultRole =
    roleOptions.find((r) => r.key === 'operator')?.key ?? roleOptions[0]?.key ?? 'operator'
  const [users, setUsers] = useState<DirectoryUser[]>(initial)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft(defaultRole))
  /** Which single control is in flight, as `<userId>:<verb>` or `new`. */
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Which row's password form is open, and what is typed in it. Never persisted, never logged. */
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  /** One request path. Returns true only when the server actually returned a saved roster. */
  async function send(init: RequestInit & { url: string }, key: string): Promise<boolean> {
    setBusyKey(key)
    setError(null)
    try {
      const { url, ...rest } = init
      const r = await fetch(url, rest)
      const d = (await r.json().catch(() => null)) as
        | { users?: DirectoryUser[]; message?: string }
        | null
      if (r.redirected || d === null) {
        // Followed to the sign-in page, or answered with something that is not our JSON.
        setError(r.redirected ? SESSION_GONE : 'The server answered with something unreadable, so nothing was saved.')
        return false
      }
      if (!r.ok) {
        setError(d.message ?? 'That change was not saved.')
        return false
      }
      if (!Array.isArray(d.users)) {
        setError(SESSION_GONE)
        return false
      }
      setUsers(d.users)
      return true
    } catch {
      setError('The server could not be reached, so nothing was saved.')
      return false
    } finally {
      setBusyKey(null)
    }
  }

  function patch(id: string, verb: string, body: Record<string, unknown>) {
    void send(
      {
        url: '/api/admin/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      },
      `${id}:${verb}`,
    )
  }

  async function addUser() {
    const saved = await send(
      {
        url: '/api/admin/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      },
      'new',
    )
    if (saved) {
      setDraft(emptyDraft(defaultRole))
      setAdding(false)
    }
  }

  async function savePassword(id: string) {
    const saved = await send(
      {
        url: '/api/admin/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, password: pw }),
      },
      `${id}:password`,
    )
    if (saved) {
      // Cleared immediately. The value never goes into component state that outlives the request,
      // never into a URL, and never into a log.
      setPw('')
      setPwFor(null)
      setNotice('Sign in set. That person can now sign in with their email and this password.')
    }
  }

  async function revoke(id: string) {
    const saved = await send(
      {
        url: '/api/admin/users',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, password: null }),
      },
      `${id}:password`,
    )
    if (saved) setNotice('Sign in removed. That person stays in the roster and can no longer sign in.')
  }

  async function remove(id: string) {
    const gone = await send(
      { url: `/api/admin/users?id=${encodeURIComponent(id)}`, method: 'DELETE' },
      `${id}:remove`,
    )
    if (gone) setConfirming(null)
  }

  const activeCount = users.filter((u) => u.status === 'active').length

  return (
    <>
      <div className={styles.rosterBar}>
        {/* A DIV, not a P, and that is load-bearing. <ExplainButton> renders its panel as a
            sibling <div popover>, and an HTML parser auto-closes a <p> when a <div> opens
            inside it. The server tree and the client tree then disagree and React throws a
            hydration error on a page that otherwise looks perfect. Measured: this exact
            markup as a <p> produced eight React #418 errors per load. */}
        <div className={styles.rosterCount}>
          {users.length} {users.length === 1 ? 'person' : 'people'} in the roster
          {activeCount !== users.length ? `, ${activeCount} active` : ''}
          <ExplainButton helpId="admin.seeded_identity" size="sm" />
        </div>
        <span className={styles.topAction}>
          <Button variant="primary" disabled={!canMutate} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Cancel' : 'Add a user'}
          </Button>
          {!canMutate && mutateBlockedReason ? (
            <span className={styles.blockedReason}>{mutateBlockedReason}</span>
          ) : null}
        </span>
      </div>

      <p className={styles.accessNote}>{accessNote}</p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {notice && !error ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}

      {adding && canMutate ? (
        <form
          className={styles.addForm}
          onSubmit={(e) => {
            e.preventDefault()
            void addUser()
          }}
        >
          <input
            className={styles.input}
            placeholder="Full name"
            aria-label="Full name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Email address"
            aria-label="Email address"
            type="email"
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
          <input
            className={styles.input}
            placeholder="Title (optional)"
            aria-label="Title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
          <select
            className={styles.input}
            aria-label="Role for the new user"
            value={draft.roleKey}
            onChange={(e) => setDraft({ ...draft, roleKey: e.target.value })}
          >
            {roleOptions.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          <Button variant="primary" type="submit" busy={busyKey === 'new'} busyLabel="Adding the user">
            Add user
          </Button>
        </form>
      ) : null}

      <section aria-label="Users" role="table" className={styles.table}>
        <div className={`${styles.row} ${styles.head}`} role="row">
          <span role="columnheader">User</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Title</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Actions</span>
          {/* A sixth column exists on every row for the reason a control is blocked. It is
              named for assistive technology and hidden visually, because a header over a
              mostly empty full-width line would read as a column that is usually broken. */}
          <span role="columnheader" className="vh">
            Notes
          </span>
        </div>

        {users.map((u) => {
          const rowBusy = busyKey?.startsWith(`${u.id}:`) ?? false
          const roleVerdict = u.actions.changeRole
          const statusVerdict = u.status === 'active' ? u.actions.deactivate : u.actions.activate
          const removeVerdict = u.actions.remove
          /*
           * The reason a control is blocked belongs in visible text on the row it blocks. The
           * ONE exception is "this user ships with the product and cannot be removed", which
           * is identical on every seeded row and printed once as a footnote under the table
           * instead. Repeating it per row buried the row-specific reason under boilerplate,
           * which is how a screen full of honest sentences ends up read by nobody.
           */
          const reasons = [roleVerdict, statusVerdict, ...(u.seeded ? [] : [removeVerdict])]
            .filter((v) => !v.allowed && v.reason)
            .map((v) => v.reason as string)
          const shownReasons = Array.from(new Set(reasons))

          return (
            <div key={u.id} className={styles.row} role="row">
              <div className={styles.user} role="cell">
                <span className={styles.avatar} aria-hidden="true">
                  {u.initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={styles.name}>{u.name}</span>
                  <br />
                  <span className={styles.email}>{u.email}</span>
                </span>
              </div>

              <span className={styles.cell} role="cell">
                <select
                  className={styles.roleSelect}
                  aria-label={`Role for ${u.name}`}
                  value={u.roleKey}
                  disabled={rowBusy || !canMutate || !roleVerdict.allowed}
                  onChange={(e) => patch(u.id, 'role', { roleKey: e.target.value })}
                >
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </span>

              <span className={styles.cell} role="cell">
                {/* Keyed on the SERVER value, so a refused or coerced save remounts the input
                    and the operator sees what was actually stored. An uncontrolled input with
                    a stable key keeps the typed text on screen looking saved. */}
                <input
                  key={`${u.id}:${u.title}`}
                  className={styles.titleInput}
                  aria-label={`Title for ${u.name}`}
                  defaultValue={u.title}
                  disabled={rowBusy || !canMutate}
                  placeholder="No title"
                  onBlur={(e) => {
                    const next = e.target.value.trim()
                    if (next !== u.title) patch(u.id, 'title', { title: next })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                />
              </span>

              <span className={styles.cell} role="cell">
                {u.status === 'active' ? (
                  <StatusChip tone="verified" srLabel="Active member of this organization">
                    Active
                  </StatusChip>
                ) : (
                  <StatusChip tone="idle" srLabel="Deactivated, kept in the roster">
                    Deactivated
                  </StatusChip>
                )}
                {/* Being in the roster is not the same as having a way in, and an operator has to
                    be able to see the difference at a glance. */}
                <StatusChip
                  tone={u.hasPassword ? 'verified' : 'idle'}
                  srLabel={u.hasPassword ? 'Has a sign in' : 'Has no sign in yet'}
                >
                  {u.hasPassword ? 'can sign in' : 'no sign in'}
                </StatusChip>
              </span>

              <span className={styles.cell} role="cell">
                <span className={styles.actions}>
                  <Button
                    variant="quiet"
                    busy={busyKey === `${u.id}:status`}
                    busyLabel="Saving"
                    disabled={rowBusy || !canMutate || !statusVerdict.allowed}
                    onClick={() =>
                      patch(u.id, 'status', { status: u.status === 'active' ? 'deactivated' : 'active' })
                    }
                  >
                    {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                  </Button>

                  <Button
                    variant="quiet"
                    disabled={rowBusy || !canMutate || u.status !== 'active'}
                    onClick={() => {
                      setPw('')
                      setNotice(null)
                      setPwFor(pwFor === u.id ? null : u.id)
                    }}
                  >
                    {u.hasPassword ? 'Change sign in' : 'Give sign in'}
                  </Button>

                  {confirming === u.id ? (
                    <>
                      <Button
                        variant="destructive"
                        busy={busyKey === `${u.id}:remove`}
                        busyLabel="Removing"
                        onClick={() => void remove(u.id)}
                      >
                        Confirm remove
                      </Button>
                      <Button variant="quiet" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="quiet"
                      disabled={rowBusy || !canMutate || !removeVerdict.allowed}
                      onClick={() => setConfirming(u.id)}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </span>

              {pwFor === u.id ? (
                <form
                  className={styles.pwForm}
                  onSubmit={(e) => {
                    e.preventDefault()
                    void savePassword(u.id)
                  }}
                >
                  <label className={styles.pwLabel} htmlFor={`pw-${u.id}`}>
                    Password for {u.name} ({u.email})
                  </label>
                  <input
                    id={`pw-${u.id}`}
                    className={styles.input}
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                  />
                  <Button
                    variant="primary"
                    type="submit"
                    busy={busyKey === `${u.id}:password`}
                    busyLabel="Saving the sign in"
                  >
                    Save sign in
                  </Button>
                  <Button variant="quiet" onClick={() => { setPw(''); setPwFor(null) }}>
                    Cancel
                  </Button>
                  {u.hasPassword ? (
                    <Button
                      variant="destructive"
                      disabled={rowBusy}
                      onClick={() => void revoke(u.id)}
                    >
                      Remove sign in
                    </Button>
                  ) : null}
                </form>
              ) : null}

              {/* Spans the whole row rather than sitting inside the actions cell, so the
                  controls above it stay on one line with every other row's controls. A
                  reason tucked into one column pushed that column's buttons out of
                  alignment with the selects beside them. Always present, so the row always
                  has the same number of cells as the header has columns; empty rows are
                  removed from the layout by `.rowReasons:empty`. */}
              <span className={styles.rowReasons} role="cell">
                {shownReasons.map((r) => (
                  <span key={r} className={styles.rowReason}>
                    {r}
                  </span>
                ))}
              </span>
            </div>
          )
        })}
      </section>

      {users.some((u) => u.seeded) ? (
        <p className={styles.tableNote}>
          David Hitchman and David Goodreau ship with the product, so their rows cannot be
          removed and would come back on the next load. Deactivate the account instead, which
          does save. Their names and email addresses are fixed for the same reason; their role,
          title and status are yours to change.
        </p>
      ) : null}
    </>
  )
}
