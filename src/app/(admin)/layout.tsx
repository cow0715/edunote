import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
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
