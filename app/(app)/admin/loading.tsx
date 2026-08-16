import { RouteLoading } from '@/components/ui/RouteLoading'

/**
 * The page is force-dynamic and reads the roster off the disk on every request, so it has a
 * wait like every other dynamic route. Five routes already ship one of these and this one did
 * not, which is the only reason it exists.
 *
 * NOTE for anyone changing the admin page: adding this file enables streaming, which is how a
 * `notFound()` on the corner route once landed after the shell had flushed and produced a
 * blank page with a 200. This page never calls `notFound()`, so it is safe, but a future edit
 * that adds one must render an in-shell message instead.
 */
export default function Loading() {
  return (
    <RouteLoading
      title="Loading Admin and Users"
      subtitle="Reading the saved roster and working out what each account may do…"
      shape="table"
    />
  )
}
