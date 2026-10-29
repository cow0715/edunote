// Isolated visual fixture. No production data or writable API connection.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RegistrationPanel } from '@/components/exam-bank/registration-panel'
import { Button } from '@/components/ui/button'
import type { ImportJob } from '@/components/pdf-import/use-jobs'

const jobs: ImportJob[] = [
  { id: 'sample-book', kind: 'bank_book', target_id: 'sample-book', status: 'waiting_batch', stage: '원본 검증 응답 대기', completed_calls: 1, attempt: 1, error: null, can_retry: false, result: null, display_title: '2027학년도 수능특강 영어독해연습 · 상', progress: { total: 106, completed: 12, questions: 108 } },
  { id: 'sample-exam', kind: 'bank_explanation', target_id: 'sample-exam', status: 'failed', stage: '해설 연결 확인', completed_calls: 26, attempt: 3, error: null, can_retry: false, result: { issues: [{ stage: 'explanations', question_number: 25, code: 'unmatched', reason: '문제은행에 해당 번호의 문항이 없어 해설을 연결할 수 없습니다.', attempts: 3 }] }, display_title: '2022년 9월 고3 모의고사' },
]
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if ((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase() !== 'GET') return Response.json({ error: '미리보기에서는 등록을 실행할 수 없습니다.' }, { status: 405 })
  if (url.startsWith('/api/book-pdf')) return Response.json({ enabled: true, documents: [] })
  if (url.startsWith('/api/pdf-import/jobs')) return Response.json(jobs)
  return Response.json({ error: '미리보기에서 지원하지 않는 요청입니다.' }, { status: 503 })
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function Preview() {
  const [dark, setDark] = useState(false)
  return <QueryClientProvider client={client}><main className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
    <header className="mb-8 flex items-start justify-between gap-4 border-b pb-5"><div><p className="text-xs text-muted-foreground">EduNote · 디자인 미리보기</p><h1 className="mt-1 text-xl font-bold">문제은행</h1><p className="mt-2 text-xs text-muted-foreground">샘플 내역 · 등록 실행 차단 · 파일 전송 없음</p></div><Button variant="outline" className="min-h-11 shrink-0" onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark) }}>{dark ? '라이트 보기' : '다크 보기'}</Button></header>
    <nav aria-label="문제은행" className="mb-7 flex gap-6 border-b text-sm"><span className="pb-3 text-muted-foreground">문항 검색</span><span className="pb-3 text-muted-foreground">자료 목록</span><span className="border-b-2 border-foreground pb-3 font-semibold">등록·처리</span></nav>
    <RegistrationPanel documentId={null} onOpenBook={() => {}} onOpenMaterial={() => {}} />
  </main></QueryClientProvider>
}
createRoot(document.getElementById('root')!).render(<Preview />)
