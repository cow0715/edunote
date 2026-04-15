'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Save } from 'lucide-react'
import { toast } from 'sonner'

interface TeacherProfile {
  id: string
  name: string
  email: string
  academy_name: string | null
  academy_english_name: string | null
  academy_address: string | null
  academy_phone: string | null
  director_name: string | null
}

export default function SettingsPage() {
  const { data, refetch, isLoading } = useQuery({
    queryKey: ['teacher-profile'],
    queryFn: async (): Promise<TeacherProfile> => {
      const res = await fetch('/api/teacher/profile')
      if (!res.ok) throw new Error('프로필 로드 실패')
      return res.json()
    },
  })

  const [form, setForm] = useState({
    name: '',
    academy_name: '',
    academy_english_name: '',
    academy_address: '',
    academy_phone: '',
    director_name: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setForm({
      name: data.name ?? '',
      academy_name: data.academy_name ?? '',
      academy_english_name: data.academy_english_name ?? '',
      academy_address: data.academy_address ?? '',
      academy_phone: data.academy_phone ?? '',
      director_name: data.director_name ?? '',
    })
  }, [data])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name || null,
          academy_name: form.academy_name || null,
          academy_english_name: form.academy_english_name || null,
          academy_address: form.academy_address || null,
          academy_phone: form.academy_phone || null,
          director_name: form.director_name || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '저장 실패')
      toast.success('저장되었습니다')
      refetch()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500">불러오는 중...</div>
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">학원 정보 설정</h1>
        <p className="text-sm text-gray-500 mt-1">성적표·메시지 등 학부모 대상 출력물에 표시됩니다.</p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">담당 강사</h2>
        <div className="space-y-2">
          <Label htmlFor="name" className="text-xs">담당 강사 이름</Label>
          <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 김선생" />
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">학원 브랜딩</h2>
        <div className="space-y-2">
          <Label htmlFor="academy_name" className="text-xs">학원명</Label>
          <Input id="academy_name" value={form.academy_name} onChange={(e) => setForm({ ...form, academy_name: e.target.value })} placeholder="예: 브라이트 영어학원" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="academy_english_name" className="text-xs">영문명</Label>
          <Input id="academy_english_name" value={form.academy_english_name} onChange={(e) => setForm({ ...form, academy_english_name: e.target.value })} placeholder="예: Brighton English Academy" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="academy_address" className="text-xs">주소</Label>
          <Input id="academy_address" value={form.academy_address} onChange={(e) => setForm({ ...form, academy_address: e.target.value })} placeholder="예: 서울 강남구 테헤란로 123" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="academy_phone" className="text-xs">전화번호</Label>
          <Input id="academy_phone" value={form.academy_phone} onChange={(e) => setForm({ ...form, academy_phone: e.target.value })} placeholder="예: 02-1234-5678" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="director_name" className="text-xs">원장 이름</Label>
          <Input id="director_name" value={form.director_name} onChange={(e) => setForm({ ...form, director_name: e.target.value })} placeholder="예: 박원장" />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>
        <Save className="mr-1.5 h-4 w-4" />
        {saving ? '저장 중...' : '저장'}
      </Button>
    </div>
  )
}
