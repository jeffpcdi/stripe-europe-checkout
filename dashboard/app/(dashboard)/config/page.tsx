import { Suspense } from 'react'
import { ConfigView } from '@/components/config/config-view'

export default function ConfigPage() {
  return (
    <Suspense>
      <ConfigView />
    </Suspense>
  )
}
