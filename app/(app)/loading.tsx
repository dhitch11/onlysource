import { RouteLoading } from '@/components/ui/RouteLoading'

/**
 * The home dashboard reads the whole corner map, the award index and the signal engine on a
 * cold process, so it is the one route most likely to make somebody wait without knowing why.
 */
export default function Loading() {
  return (
    <RouteLoading
      title="Reading today's market"
      subtitle="Scoring every open requirement against the corner map to find what needs you first…"
      shape="cards"
    />
  )
}
