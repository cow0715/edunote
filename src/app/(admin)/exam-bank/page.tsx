'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, FolderOpen } from 'lucide-react'
import { ExamList } from '@/components/exam-bank/exam-list'
import { QuestionSearch } from '@/components/exam-bank/question-search'
import { VocabCollections } from '@/components/exam-bank/vocab-collections'
import { UploadDialog } from '@/components/exam-bank/upload-dialog'
import { BulkExplanationDialog } from '@/components/exam-bank/bulk-explanation-dialog'

// ── 메인 페이지 ──────────────────────────────────────────────────────────

export default function ExamBankPage() {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">기출문제 은행</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            일괄 해설
          </Button>
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            PDF 업로드
          </Button>
        </div>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">시험 목록</TabsTrigger>
          <TabsTrigger value="search">문제 검색</TabsTrigger>
          <TabsTrigger value="vocab">단어장</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <ExamList />
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <QuestionSearch />
        </TabsContent>

        <TabsContent value="vocab" className="mt-4">
          <VocabCollections />
        </TabsContent>
      </Tabs>

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <BulkExplanationDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  )
}
