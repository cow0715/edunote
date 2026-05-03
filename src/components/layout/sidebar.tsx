'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  BookOpen,
  FileSearch,
  GraduationCap,
  LibraryBig,
  LogOut,
  MessageSquare,
  ScanText,
  Settings,
  Tag,
  Terminal,
  TrendingUp,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const navSections = [
  {
    title: '수업 운영',
    items: [
      { href: '/dashboard', label: '수업 목록', icon: BookOpen },
      { href: '/students', label: '학생 관리', icon: Users },
      { href: '/analysis', label: '학생 현황', icon: TrendingUp },
      { href: '/messages', label: '메시지 내역', icon: MessageSquare },
    ],
  },
  {
    title: '문항 / 자료',
    items: [
      { href: '/exam-bank', label: '기출문제 은행', icon: LibraryBig },
      { href: '/concept-tags', label: '문제 유형', icon: Tag },
      { href: '/text-compare', label: '시험 변형 분석', icon: FileSearch },
      { href: '/pdf-extract', label: 'PDF 텍스트 추출', icon: ScanText },
    ],
  },
  {
    title: '설정',
    items: [
      { href: '/settings', label: '학원 정보 설정', icon: Settings },
    ],
  },
]

const devItems = [
  { href: '/dev', label: '개발자 도구', icon: Terminal },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('로그아웃되었습니다.')
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="hidden h-full w-56 flex-col border-r bg-card md:flex">
      <div className="flex items-center gap-2 border-b px-4 py-5">
        <GraduationCap className="h-6 w-6 text-primary" />
        <span className="font-semibold text-gray-900">학원 관리</span>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto p-3">
        {navSections.map((section) => (
          <div key={section.title} className="space-y-1">
            <p className="px-3 pb-1 text-xs font-semibold text-gray-400">
              {section.title}
            </p>
            {section.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t p-3">
        {devItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href || pathname.startsWith(`${href}/`)
                ? 'bg-primary/10 text-primary'
                : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}

        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-gray-600"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </Button>
      </div>
    </aside>
  )
}
