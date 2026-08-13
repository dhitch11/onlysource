import type { HelpRecord } from '@/components/help/registry'

/**
 * T7 ADMIN + API help entries.
 *
 * Lives in a file this lane owns and is registered from `components/help/registry.ts` with one
 * import, following @T4's precedent, so the shared registry stays out of the merge path.
 *
 * The charter's rule for this lane's surfaces is stricter than the general one: **generate the
 * help from the model that enforces it.** A role or scope explanation written by hand drifts
 * from the permissions within one sprint, and a wrong explanation of a permission is worse than
 * none. So `role.assignment` below explains the MECHANISM (the server enforces the permission
 * set, the name is not the grant) rather than listing permissions that would go stale. The
 * per-role permission list is rendered live from `describeRole()`, never typed here.
 *
 * Note for anyone editing: `validateHelp` fails on an em dash in any field. That is house law 7
 * enforced by the gate rather than by review, which is the right way round.
 */
export const T7_ENTRIES: HelpRecord[] = [
  {
    id: 'admin.role',
    owner: 'T7 ADMIN + API',
    title: 'Role',
    what: 'A named set of permissions the server enforces on every request, not a label on a person.',
    how: 'Change a role to change what someone can reach. The list beside each role is generated from the permissions it actually holds, so it cannot drift from what the server does.',
    why: 'A role is the difference between an operator seeing a supplier margin and not seeing it. Getting it wrong exposes negotiating positions to people who should not hold them.',
    source: 'The permission set on the role record, read at request time. Renaming a role grants nothing.',
  },
  {
    id: 'admin.plane',
    owner: 'T7 ADMIN + API',
    title: 'Admin plane',
    what: 'The privileged console is a separate authorization domain from the daily operator surface.',
    how: 'Only a role that is admin-plane AND holds at least one admin permission can reach it. An operator role cannot be given an admin permission at all.',
    why: 'One permission check shared between the two planes means both inherit the weaker one. That is the failure that ends a company rather than a sprint.',
    source: 'Enforced server-side on every request and structurally at role construction, which refuses to build an operator role holding an admin permission.',
  },
  {
    id: 'admin.connection_state',
    owner: 'T7 ADMIN + API',
    title: 'Connection state',
    what: 'Whether a data source is connected, and if so whether its data actually flows into the product.',
    how: 'Read the words, never a colour. Not connected means no credential. Raw access means the credential is proven and live pass through works. Fully integrated means its data reaches scoring and documents.',
    why: 'Raw access and full integration are different promises. One green dot implying data is flowing when only the login works is a fabrication in a settings screen.',
    source: 'The stored connection row plus its last health probe, which performs a real operation rather than checking that the host answers.',
  },
  {
    id: 'admin.seeded_identity',
    owner: 'T7 ADMIN + API',
    title: 'Seeded identity',
    what: 'These users are the organization identity the product ships with, not rows read from a database.',
    how: 'Treat the names and roles as settled. Treat anything that would need saving, such as a deactivation or a new invitation, as unavailable until the database is connected.',
    why: 'A screen that accepts a change it cannot save is worse than one that says it cannot. The operator would believe an account was closed when it was not.',
    source: 'The approved build directive. The database that would persist changes is not configured in this build, and the screen says so rather than implying otherwise.',
  },
]
