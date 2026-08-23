'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            // 탭 복귀마다 재요청하면 공유 페이지처럼 페이로드가 큰 쿼리가 매번 다시 내려와 전체 리렌더를 유발한다.
            // 이 앱은 강사 1명이 편집하는 구조라 포커스 재검증 없이도 데이터가 어긋날 일이 거의 없다.
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}
