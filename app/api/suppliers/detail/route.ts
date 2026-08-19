/**
 * ONE SUPPLIER'S CONTACT DETAILS, FOR SOMEONE ALLOWED TO SEE THEM.
 *
 * =====================================================================================
 * WHY THIS ROUTE EXISTS, AND IT IS NOT A PERFORMANCE ROUTE
 * =====================================================================================
 * `/suppliers` used to serialise the entire book into the page, including the names, job
 * titles, email addresses, phone numbers and LinkedIn profiles of every contact at 3,471
 * companies. 9,748 people, on every authorized page load, to render 544 rows.
 *
 * `supplier.identity.view` is marked `sensitive: true` in `lib/admin/permissions.ts`, and the
 * `read_only` role is defined as every non-sensitive operator permission and nothing marked
 * sensitive, so it deliberately does not hold it. **The page carried no permission check at
 * all.** The permission existed, was correctly classified, and the role correctly withheld it;
 * the read path never asked. Four of the fourteen permissions govern SEEING a fact, and gating
 * only the routes that MUTATE leaves every one of them unenforced.
 *
 * So the contact details left the product entirely and came back here, behind the permission
 * that governs them, ONE COMPANY AT A TIME, and only when a person opens that company's row.
 *
 * =====================================================================================
 * WHAT IT REFUSES, AND WHY EACH REFUSAL IS SHAPED THE WAY IT IS
 * =====================================================================================
 * 1. **No permission, no data, and the refusal SAYS SO.** A caller without
 *    `supplier.identity.view` gets a 403 naming the boundary, not an empty list. An empty list
 *    reads as "this company has no contacts", which is a false statement about the world rather
 *    than a true one about the caller.
 * 2. **One CAGE per request, and no list form.** There is deliberately no `?cages=a,b,c` and no
 *    "all" mode. A bulk accessor behind a permission check is the same payload with an extra
 *    step, and it turns one careless caller into the defect this route was built to close.
 * 3. **An unknown CAGE is a 404, not an empty success.** Silence about a company we do not hold
 *    must not be indistinguishable from a company with nobody on file.
 */
import { NextRequest } from 'next/server'

import { requirePermission } from '@/lib/session/authz'
import { buildDistressedSuppliers } from '@/lib/intelligence/suppliers/distressed'
import { toDetail } from '@/app/(app)/suppliers/wire-lean'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** One supplier's held-back detail. Requires `supplier.identity.view`. Query: `?cage=XXXXX`. */
export async function GET(req: NextRequest) {
  const denied = await requirePermission('supplier.identity.view')
  if (denied) return denied

  const cage = (req.nextUrl.searchParams.get('cage') ?? '').trim().toUpperCase()
  if (!cage) return Response.json({ error: 'no_cage' }, { status: 400 })

  const ix = buildDistressedSuppliers()
  if (!ix.ok) return Response.json({ error: 'index_unavailable', reason: ix.reason }, { status: 503 })

  const row = ix.suppliers.find((s) => s.cage.toUpperCase() === cage)
  if (!row) {
    // Not an empty success: "we do not hold this company" and "this company has nobody on file"
    // are different facts and a surface must be able to tell them apart.
    return Response.json({ error: 'not_found', cage }, { status: 404 })
  }
  return Response.json({ detail: toDetail(row) })
}
