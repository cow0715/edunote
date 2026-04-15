'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Plus, Trash2, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  useReportCards,
  useCreateReportCard,
  useDeleteReportCard,
} from '@/hooks/use-report-cards'
import {
  getMonthlyPeriod,
  getQuarterlyPeriod,
  getSemesterPeriod,
  type PeriodType,
} from '@/lib/report-card'

interface Props {
  open: boolean
  onClose: () => void
  studentId: string
  studentName: string
}

export function ReportCardListDialog({ open, onClose, studentId, studentName }: Props) {
  const router = useRouter()
  const { data: cards = [], isLoading } = useReportCards(open ? studentId : undefined)
  const createCard = useCreateReportCard()
  const deleteCard = useDeleteReportCard()

  const [mode, setMode] = useState<'list' | 'create'>('list')
  const today = new Date()
  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1) // 1~12
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(Math.ceil((today.getMonth() + 1) / 3) as 1 | 2 | 3 | 4)
  const [semester, setSemester] = useState<1 | 2>(today.getMonth() + 1 >= 3 && today.getMonth() + 1 <= 8 ? 1 : 2)

  const preview = useMemo(() => {
    if (periodType === 'monthly') return getMonthlyPeriod(year, month)
    if (periodType === 'quarterly') return getQuarterlyPeriod(year, quarter)
    return getSemesterPeriod(year, semester)
  }, [periodType, year, month, quarter, semester])

  async function handleCreate() {
    const card = await createCard.mutateAsync({
      student_id: studentId,
      period_type: periodType,
      period_start: preview.start,
      period_end: preview.end,
      period_label: preview.label,
    })
    onClose()
    router.push(`/students/${studentId}/report-cards/${card.id}`)
  }

  function handleOpen(cardId: string) {
    onClose()
    router.push(`/students/${studentId}/report-cards/${cardId}`)
  }

  function handleDelete(cardId: string) {
    if (!confirm('삭제하시겠습니까?')) return
    deleteCard.mutate({ id: cardId, studentId })
  }

  const yearOptions = useMemo(() => {
    const y = today.getFullYear()
    return [y + 1, y, y - 1, y - 2]
  }, [today])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {studentName} 성적표
          </DialogTitle>
        </DialogHeader>

        {mode === 'list' ? (
          <div className="space-y-3 pt-2">
            <Button onClick={() => setMode('create')} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              새 성적표 발급
            </Button>

            {isLoading ? (
              <div className="space-y-2">
                {[0, 1].map((i) => (
                  <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : cards.length === 0 ? (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-gray-400">
                발급된 성적표가 없습니다
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2.5 hover:border-primary/40 hover:shadow-sm transition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{c.period_label}</span>
                        {c.status === 'published' ? (
                          <Badge className="text-[10px] bg-blue-50 text-blue-600 border-blue-200" variant="secondary">
                            발급 완료
                          </Badge>
                        ) : (
                          <Badge className="text-[10px] bg-gray-100 text-gray-500" variant="secondary">
                            임시저장
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {c.period_start} ~ {c.period_end}
                      </p>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => handleOpen(c.id)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-red-500 hover:text-red-600"
                        disabled={deleteCard.isPending}
                        onClick={() => handleDelete(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>종류</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { v: 'monthly', label: '월간' },
                  { v: 'quarterly', label: '분기' },
                  { v: 'semester', label: '학기' },
                ] as { v: PeriodType; label: string }[]).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setPeriodType(o.v)}
                    className={`rounded-md border px-3 py-2 text-sm transition ${
                      periodType === o.v
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>연도</Label>
                <select
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>{periodType === 'monthly' ? '월' : periodType === 'quarterly' ? '분기' : '학기'}</Label>
                {periodType === 'monthly' && (
                  <select
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{m}월</option>
                    ))}
                  </select>
                )}
                {periodType === 'quarterly' && (
                  <select
                    value={quarter}
                    onChange={(e) => setQuarter(Number(e.target.value) as 1 | 2 | 3 | 4)}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  >
                    {[1, 2, 3, 4].map((q) => (
                      <option key={q} value={q}>{q}분기</option>
                    ))}
                  </select>
                )}
                {periodType === 'semester' && (
                  <select
                    value={semester}
                    onChange={(e) => setSemester(Number(e.target.value) as 1 | 2)}
                    className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                  >
                    <option value={1}>1학기</option>
                    <option value={2}>2학기</option>
                  </select>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-xs text-gray-500">발급 기간</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5">
                {preview.label}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {preview.start} ~ {preview.end}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setMode('list')} disabled={createCard.isPending}>
                취소
              </Button>
              <Button onClick={handleCreate} disabled={createCard.isPending}>
                {createCard.isPending ? '발급 중...' : '발급'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
