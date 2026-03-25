'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { BookOpen, Users, LogOut, GraduationCap, Tag, MessageSquare, TrendingUp, Menu } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const navItems = [
  { href: '/dashboard', label: '수업 목록', icon: BookOpen },
  { href: '/students', label: '학생 관리', icon: Users },
  { href: '/concept-tags', label: '문제 유형', icon: Tag },
  { href: '/analysis', label: '학생 현황', icon: TrendingUp },
  { href: '/messages', label: '메시지 내역', icon: MessageSquare },
]

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    const main = document.querySelector('main')
    if (main) main.style.overflow = open ? 'hidden' : ''
    return () => { if (main) main.style.overflow = '' }
  }, [open])
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('로그아웃되었습니다')
    router.push('/login')
    router.refresh()
  }

  const currentLabel = navItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  )?.label ?? '학원 관리'

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b bg-white px-4 md:hidden shrink-0">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="font-semibold text-gray-900 text-sm">{currentLabel}</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-56 p-0 flex flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-5">
            <GraduationCap className="h-6 w-6 text-primary" />
            <span className="font-semibold text-gray-900">학원 관리</span>
          </div>

          <nav className="flex-1 space-y-1 p-3">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
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

          <div className="border-t p-3">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-gray-600"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
