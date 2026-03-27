'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { BookOpen, Users, LogOut, GraduationCap, Tag, MessageSquare, TrendingUp, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const navItems = [
  { href: '/dashboard', label: '수업 목록', icon: BookOpen },
  { href: '/students', label: '학생 관리', icon: Users },
  { href: '/concept-tags', label: '문제 유형', icon: Tag },
  { href: '/analysis', label: '학생 현황', icon: TrendingUp },
  { href: '/messages', label: '메시지 내역', icon: MessageSquare },
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
    toast.success('로그아웃되었습니다')
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="hidden md:flex h-full w-56 flex-col border-r bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-5">
        <GraduationCap className="h-6 w-6 text-primary" />
        <span className="font-semibold text-gray-900">학원 관리</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href || pathname.startsWith(href + '/')
                ? 'bg-primary/10 text-primary'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="border-t p-3 space-y-1">
        {devItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              pathname === href || pathname.startsWith(href + '/')
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
