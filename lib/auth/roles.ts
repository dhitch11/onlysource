/**
 * ROLES AND PERMISSIONS. Six roles at launch, no more.
 *
 * PERMISSION SLUGS ARE IMMUTABLE STRINGS. Renaming one is a silent authorization change:
 * the old slug stops matching, the check quietly passes or quietly fails, and no test says
 * so. Add new slugs, deprecate old ones, never rename.
 *
 * WHY SIX AND NOT FOUR. `buyer` is split out from `admin` deliberately, because the person
 * who adds a user is very often not the person allowed to commit money to a supplier.
 * Conflating them is how a junior employee submits a binding quote. `docs` exists so the
 * back office can run the paperwork engine with NO pricing visibility at all.
 *
 * A HIDDEN BUTTON IS NOT A PERMISSION. Everything here is enforced server-side at one
 * `authorize()` call site with the resource in hand, with RLS underneath as the second
 * line. Hiding a control is a courtesy to the user, never a control.
 */

export const ROLES = ['owner', 'admin', 'buyer', 'operator', 'docs', 'read_only'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  // membership and org administration
  'member:invite',
  'member:remove',
  'member:role_change',
  'org:settings_write',
  'org:delete',
  'ownership:transfer',
  // the money authority, split from admin on purpose
  'quote:submit',
  'po:approve',
  'supplier:commit',
  // operating the queue
  'requirement:read',
  'requirement:annotate',
  'packet:build',
  'quote:request',
  // documents and compliance
  'document:read',
  'document:write',
  'drawing:view_export_controlled',
  // commercial visibility. ONE permission, applied consistently everywhere, because it is
  // enforced in twelve places or it is enforced nowhere.
  'pricing:view_cost_basis',
  // exports and audit
  'data:export',
  'audit:read',
  // staff-side, reserved and unassigned to any tenant role
  'impersonation:start',
  // reserved for the billing seam that is deliberately not built yet. Assigning it today
  // would be hardcoding against a feature we have said will exist.
  'billing:manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/**
 * The role matrix. This is DATA, not scattered `if` statements, so "who can see this and
 * why" is answerable in one place and renderable in plain language in org settings.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: [
    'member:invite',
    'member:remove',
    'member:role_change',
    'org:settings_write',
    'org:delete',
    'ownership:transfer',
    'quote:submit',
    'po:approve',
    'supplier:commit',
    'requirement:read',
    'requirement:annotate',
    'packet:build',
    'quote:request',
    'document:read',
    'document:write',
    'drawing:view_export_controlled',
    'pricing:view_cost_basis',
    'data:export',
    'audit:read',
  ],
  admin: [
    'member:invite',
    'member:remove',
    'member:role_change',
    'org:settings_write',
    'requirement:read',
    'requirement:annotate',
    'packet:build',
    'quote:request',
    'document:read',
    'document:write',
    'data:export',
    'audit:read',
    // NOT quote:submit, NOT po:approve, NOT supplier:commit. That is the whole point of
    // splitting buyer out. An admin manages the workspace; they do not commit money.
    // NOT org:delete, NOT ownership:transfer.
  ],
  buyer: [
    'quote:submit',
    'po:approve',
    'supplier:commit',
    'requirement:read',
    'requirement:annotate',
    'packet:build',
    'quote:request',
    'document:read',
    'pricing:view_cost_basis',
    'data:export',
  ],
  operator: [
    'requirement:read',
    'requirement:annotate',
    'packet:build',
    'quote:request',
    'document:read',
    // Reads, scores, annotates, builds packets, requests quotes. Cannot submit or commit.
  ],
  docs: [
    'requirement:read',
    'document:read',
    'document:write',
    'drawing:view_export_controlled',
    'data:export',
    // NO pricing:view_cost_basis. The back office runs the paperwork engine without ever
    // seeing what anything costs.
  ],
  read_only: [
    'requirement:read',
    'document:read',
    // Reads. Exports NOTHING, deliberately: `data:export` is absent, so an auditor, a
    // lender or a new hire cannot walk out with the dataset. Free seats.
  ],
}

/** Does this role carry this permission. The single source of truth for the answer. */
export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Plain-language descriptions, rendered in org settings so the matrix is legible. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Everything, plus deleting the organization and transferring ownership. Exactly one per organization.',
  admin: 'Manages people, settings and integrations. Cannot submit a quote or commit to a supplier.',
  buyer: 'The money authority. Submits quotes, approves purchase orders, commits to suppliers, sees cost basis.',
  operator: 'Works the queue. Reads, annotates, builds packets and requests quotes. Cannot submit or commit.',
  docs: 'Back office. Runs traceability and compliance paperwork, with no visibility of pricing at all.',
  read_only: 'Reads. Exports nothing. For an auditor, a lender, or somebody new.',
}
