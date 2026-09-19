import { Suspense } from 'react'
import { ConversionsView } from '@/components/conversions/conversions-view'

export default function ConversionsPage() {
  return (
    <Suspense>
      <ConversionsView />
    </Suspense>
  )
}
