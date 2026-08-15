import { RouteLoading } from '@/components/ui/RouteLoading'
export default function Loading() {
  return (
    <RouteLoading
      title="Loading the supplier book"
      subtitle="Reading the distressed-supplier list and verified contacts…"
      shape="table"
    />
  )
}
