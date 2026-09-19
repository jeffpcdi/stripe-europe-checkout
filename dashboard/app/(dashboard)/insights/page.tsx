import { Suspense } from 'react'
import { InsightsView } from '@/components/insights/insights-view'

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsView />
    </Suspense>
  )
}
