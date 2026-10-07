import { Suspense } from 'react'
import ShareDesignFrame from './share-design-frame'

export default function ShareDesignFramePage() {
  return <Suspense fallback={null}><ShareDesignFrame /></Suspense>
}
