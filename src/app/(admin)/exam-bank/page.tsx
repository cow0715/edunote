'use client'

import { Suspense } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload } from 'lucide-react'
import { ExamList } from '@/components/exam-bank/exam-list'
import { QuestionSearch } from '@/components/exam-bank/question-search'
import { VocabCollections } from '@/components/exam-bank/vocab-collections'
import { RegistrationPanel } from '@/components/exam-bank/registration-panel'
import { isActiveImport, usePdfImportJobs } from '@/components/pdf-import/use-jobs'
import { bankTab, type BankTab } from '@/lib/exam-bank-navigation'

// ── 메인 페이지 ──────────────────────────────────────────────────────────

export default function ExamBankPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">문제은행을 불러오는 중…</p>}><BankContents /></Suspense>
}
function BankContents() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams()
  const tab = bankTab(params.get('tab')), jobs = usePdfImportJobs(), active = (jobs.data ?? []).filter(isActiveImport).length
  function navigate(next: BankTab, key?: 'document' | 'material', id?: string) {
    const search = new URLSearchParams(window.location.search)
    search.set('tab', next)
    if (key && id) search.set(key, id)
    router.replace(`${pathname}?${search.toString()}`, { scroll: false })
  }
  const openBook = (id: string) => navigate('import', 'document', id)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">문제은행</h1>
          {tab !== 'import' && <Button className="min-h-11" onClick={() => navigate('import')}>
            <Upload className="mr-2 h-4 w-4" />
            자료 등록
          </Button>}
      </div>
      {active > 0 && tab !== 'import' && <button onClick={() => navigate('import')} className="w-full rounded-xl bg-muted p-3 text-left text-sm">자료 {active}건 처리 중 · 등록·처리에서 확인</button>}
      <Tabs value={tab} onValueChange={(value) => navigate(value as BankTab)}>
        <TabsList className="grid h-auto min-h-[52px] w-full grid-cols-4 sm:inline-flex sm:w-auto">
          <TabsTrigger className="min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" value="search">문제 검색</TabsTrigger>
          <TabsTrigger className="min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" value="list">자료 목록</TabsTrigger>
          <TabsTrigger className="min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" value="vocab">단어장</TabsTrigger>
          <TabsTrigger className="min-h-11 min-w-0 px-2 text-xs sm:px-3 sm:text-sm" value="import">등록·처리{active > 0 ? ` ${active}` : ''}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <ExamList selectedId={params.get('material')} onOpenBook={openBook} onRegister={() => navigate('import')} />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <QuestionSearch />
        </TabsContent>

        <TabsContent value="vocab" className="mt-4">
          <VocabCollections />
        </TabsContent>
        <TabsContent value="import" className="mt-4"><RegistrationPanel documentId={params.get('document')} onOpenBook={openBook} onOpenMaterial={(id) => navigate('list', 'material', id)} /></TabsContent>
      </Tabs>

    </div>
  )
}
