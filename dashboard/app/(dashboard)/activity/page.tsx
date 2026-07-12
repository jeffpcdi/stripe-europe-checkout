import { Suspense } from 'react'
import { ActivityView } from '@/components/activity/activity-view'

// Suspense obrigatória: ActivityView usa useSearchParams (deep-link ?f= do
// item 292), que no build estático exige um boundary acima do hook.
export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  )
}
