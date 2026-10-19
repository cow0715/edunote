import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FileUpload } from '@/components/ui/file-upload'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Segmented, Chip } from '@/app/share/[token]/share-ui'
import { Card } from '@/app/share/[token]/share-components'

function Preview() {
  const [dark, setDark] = useState(true)
  const [file, setFile] = useState('')
  const [tab, setTab] = useState('reading')
  return <main className="mx-auto max-w-5xl p-4 sm:p-8">
    <header className="mb-6 flex items-center justify-between gap-4">
      <div><h1 className="text-xl font-bold">업로드·색상 검토</h1><p className="mt-1 text-sm text-muted-foreground">샘플 데이터 전용 · 파일은 전송되지 않습니다</p></div>
      <Button onClick={() => { document.documentElement.classList.toggle('dark', !dark); setDark(!dark) }}>{dark ? '라이트 보기' : '다크 보기'}</Button>
    </header>
    <div className="grid items-start gap-6 md:grid-cols-2">
      <section className="space-y-4 rounded-[20px] bg-card p-5">
        <h2 className="font-bold">백오피스 파일 선택</h2>
        <FileUpload label="시험지 파일 선택" description="PDF 또는 이미지 · 여러 파일 선택 가능" accept=".pdf,image/*" multiple fileName={file} onClear={() => setFile('')} onChange={(event) => setFile(Array.from(event.target.files ?? []).map((item) => item.name).join(', '))} />
        <FileUpload label="엑셀 단어장 선택" description="XLSX 파일 1개" accept=".xlsx" fileName="고등학교_2학기_중간고사_대비_아주_긴_단어장_파일이름_2026.xlsx" onChange={() => {}} />
        <div className="flex flex-wrap gap-2"><FileUpload compact label="답안지 촬영" accept="image/*" onChange={() => {}} /><FileUpload compact label="처리 중" accept=".pdf" loading onChange={() => {}} /></div>
        <Input placeholder="파일 설명" aria-label="파일 설명" />
        <div className="flex items-center gap-2"><Checkbox id="preview-selected" defaultChecked /><label htmlFor="preview-selected" className="text-sm">선택된 항목</label></div>
        <div className="flex gap-2"><Button variant="outline">취소</Button><Button>다른 파일 선택</Button><Button variant="action">등록</Button></div>
      </section>
      <section className="mx-auto w-full max-w-[430px] space-y-3 rounded-[20px] bg-[var(--share-canvas)] p-4">
        <h2 className="text-xl font-bold text-[var(--share-ink)]">학생 리포트</h2>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'reading', label: '진단평가 16' }, { value: 'vocab', label: '단어 12' }]} />
        <button className="w-full rounded-[20px] bg-[var(--control-bg)] p-5 text-left text-[var(--control-fg)]"><span className="font-bold">17문항 다시 풀기</span><span className="mt-1 block text-xs text-[var(--share-muted)]">약 17분 · 자료가 준비된 문항</span></button>
        <Card title="이번 기간 학습 기록"><div className="space-y-4"><p className="text-sm text-[var(--share-body)]">본문과 보조 글자의 대비를 확인합니다.</p><p className="text-xs text-[var(--share-muted2)]">9월 30일 · 최근 수업</p><div className="flex gap-2"><Chip tone="blue">정답</Chip><Chip tone="red">오답</Chip><Chip>미응시</Chip></div><Button variant="action" className="w-full">정답 확인</Button><Button disabled className="w-full">답을 선택해 주세요</Button></div></Card>
      </section>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Preview />)
