'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', name: '' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || '회원가입에 실패했습니다')
        return
      }

      toast.success('회원가입 신청이 완료되었습니다. 관리자 승인 후 이용할 수 있습니다.')
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#EBF3FF] to-white px-4">
      <Card className="w-full max-w-sm border-0 shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl text-[#1A1C1E]">회원가입</CardTitle>
          <CardDescription className="text-[#8B95A1]">
            강사 계정을 신청합니다. 가입 후 관리자 승인이 필요합니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">이름</Label>
              <Input
                id="name"
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="teacher@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                placeholder="8자 이상"
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <Button type="submit" className="w-full bg-[#2463EB] hover:bg-[#1d4ed8]" disabled={loading}>
              {loading ? '처리 중...' : '가입 신청'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-[#8B95A1]">
            이미 계정이 있나요?{' '}
            <Link href="/login" className="text-[#2463EB] underline">
              로그인
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
