'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
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

export function AdminConsole({
  initial,
  roleOptions,
  accessNote,
}: {
  initial: DirectoryUser[]
  roleOptions: RoleOption[]
  accessNote: string
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

  /** One request path. Returns true when the server saved it. */
  async function send(init: RequestInit & { url: string }, key: string): Promise<boolean> {
    setBusyKey(key)
    setError(null)
    try {
      const { url, ...rest } = init
      const r = await fetch(url, rest)
      const d = (await r.json().catch(() => ({}))) as { users?: DirectoryUser[]; message?: string }
      if (!r.ok) {
        setError(d.message ?? 'That change was not saved.')
        return false
      }
      if (d.users) setUsers(d.users)
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
        <p className={styles.rosterCount}>
          {users.length} {users.length === 1 ? 'person' : 'people'} in the roster
          {activeCount !== users.length ? `, ${activeCount} active` : ''}
        </p>
        <Button variant="primary" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Add a user'}
        </Button>
      </div>

      <p className={styles.accessNote}>{accessNote}</p>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {adding ? (
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

      <section aria-label="Users" className={styles.table}>
        <div className={`${styles.row} ${styles.head}`} role="row">
          <span>User</span>
          <span>Role</span>
          <span>Title</span>
          <span>Status</span>
          <span>Actions</span>
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
              <div className={styles.user}>
                <span className={styles.avatar} aria-hidden="true">
                  {u.initials}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className={styles.name}>{u.name}</span>
                  <br />
                  <span className={styles.email}>{u.email}</span>
                </span>
              </div>

              <span className={styles.cell}>
                <select
                  className={styles.roleSelect}
                  aria-label={`Role for ${u.name}`}
                  value={u.roleKey}
                  disabled={rowBusy || !roleVerdict.allowed}
                  onChange={(e) => patch(u.id, 'role', { roleKey: e.target.value })}
                >
                  {roleOptions.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </span>

              <span className={styles.cell}>
                <input
                  className={styles.titleInput}
                  aria-label={`Title for ${u.name}`}
                  defaultValue={u.title}
                  disabled={rowBusy}
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

              <span className={styles.cell}>
                {u.status === 'active' ? (
                  <StatusChip tone="verified" srLabel="Active member of this organization">
                    Active
                  </StatusChip>
                ) : (
                  <StatusChip tone="idle" srLabel="Deactivated, kept in the roster">
                    Deactivated
                  </StatusChip>
                )}
              </span>

              <span className={styles.cell}>
                <span className={styles.actions}>
                  <Button
                    variant="quiet"
                    busy={busyKey === `${u.id}:status`}
                    busyLabel="Saving"
                    disabled={rowBusy || !statusVerdict.allowed}
                    onClick={() =>
                      patch(u.id, 'status', { status: u.status === 'active' ? 'deactivated' : 'active' })
                    }
                  >
                    {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
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
                      disabled={rowBusy || !removeVerdict.allowed}
                      onClick={() => setConfirming(u.id)}
                    >
                      Remove
                    </Button>
                  )}
                </span>
              </span>

              {/* Spans the whole row rather than sitting inside the actions cell, so the
                  controls above it stay on one line with every other row's controls. A
                  reason tucked into one column pushed that column's buttons out of
                  alignment with the selects beside them. */}
              {shownReasons.length ? (
                <span className={styles.rowReasons}>
                  {shownReasons.map((r) => (
                    <span key={r} className={styles.rowReason}>
                      {r}
                    </span>
                  ))}
                </span>
              ) : null}
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
