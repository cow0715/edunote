import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTeacherAccess } from '@/lib/api'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const teacher = await getTeacherAccess(supabase, user.id)

  if (!teacher || teacher.approval_status !== 'approved') {
    const isBlocked = teacher?.approval_status === 'blocked'

    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-[#EBF3FF] to-white px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-[0px_10px_40px_rgba(0,75,198,0.03)]">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-xl font-bold text-[#2463EB]">
            EN
          </div>
          <h1 className="text-2xl font-bold text-[#1A1C1E]">
            {isBlocked ? '사용이 제한된 계정입니다' : '관리자 승인 대기 중입니다'}
          </h1>
          <p className="mt-3 text-sm leading-6 text-[#8B95A1]">
            {isBlocked
              ? '이 계정은 현재 EduNote 사용 권한이 없습니다. 관리자에게 문의해 주세요.'
              : '가입 신청은 완료되었습니다. 관리자가 계정을 승인하면 서비스를 사용할 수 있습니다.'}
          </p>
          <p className="mt-6 text-xs text-[#8B95A1]">{user.email}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-gray-50 print:block print:h-auto print:bg-white md:flex-row">
      <div className="print:hidden">
        <Sidebar />
        <MobileNav />
      </div>
      <main className="flex-1 overflow-auto print:block print:overflow-visible">
        <div className="p-4 print:p-0 md:p-6">{children}</div>
      </main>
    </div>
  )
}
