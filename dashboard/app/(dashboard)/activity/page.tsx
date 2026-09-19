import { Suspense } from 'react'
import { ActivityView } from '@/components/activity/activity-view'

export default function ActivityPage() {
  return (
    <Suspense>
      <ActivityView />
    </Suspense>
  )
}
