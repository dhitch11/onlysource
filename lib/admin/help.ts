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
    how: 'Give someone an admin role only when they must manage users, roles or connections. Do not try to add an admin permission to an operator role; the server refuses to build one, so plan the role split first.',
    why: 'One permission check shared between the two planes means both inherit the weaker one. That is the failure that ends a company rather than a sprint.',
    source: 'Enforced server-side on every request and structurally at role construction, which refuses to build an operator role holding an admin permission.',
  },
  {
    id: 'admin.connection_state',
    owner: 'T7 ADMIN + API',
    title: 'Connection state',
    what: 'Whether a data source is connected, and if so whether its data actually flows into the product.',
    how: 'Read the words, never a color. Not connected means no credential. Raw access means the credential is proven and live pass through works. Fully integrated means its data reaches scoring and documents.',
    why: 'Raw access and full integration are different promises. One green dot implying data is flowing when only the login works is a fabrication in a settings screen.',
    source: 'The stored connection row plus its last health probe, which performs a real operation rather than checking that the host answers.',
  },
  {
    id: 'admin.seeded_identity',
    owner: 'T7 ADMIN + API',
    title: 'Seeded identity',
    what: 'David Hitchman and David Goodreau are the organization identity the product ships with, not rows read from a database.',
    how: 'Treat their names and email addresses as settled, because this screen deliberately cannot rewrite them. Their role, their title and whether the account is active are yours to change, and those do save.',
    why: 'Removing a seeded row would only bring it back on the next load, so an operator would believe an account was closed when it was not. Deactivation is the verb that actually holds.',
    source: 'The approved build directive for the names and the addresses. The server state directory for every change made since.',
  },
  {
    id: 'admin.roster',
    owner: 'T7 ADMIN + API',
    title: 'The roster',
    what: 'Who is in the ONLYSOURCE organization and what role each person holds. Saved on the server.',
    how: 'Add a person, change a role, deactivate an account. Every change is written to the server and is still there on the next load. Adding somebody does not email them; they can sign in with their email the moment you set a password for them here, and not before.',
    why: 'A role decides who can see a supplier identity, a margin or a document body. A roster that quietly dropped a change would leave somebody holding access you believed you had taken away.',
    source: 'The seeded organization from the approved build directive, merged with every change an operator has saved, held in the server state directory that survives a deploy.',
  },
]
