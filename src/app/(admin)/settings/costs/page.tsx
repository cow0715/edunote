import { redirect } from 'next/navigation'
import { getAuth, getTeacherAccess } from '@/lib/api'
import { CostDashboard } from './cost-dashboard'

export default async function CostsPage() {
  const { supabase, user } = await getAuth()
  if (!user) redirect('/login')
  const teacher = await getTeacherAccess(supabase, user.id)
  if (!teacher?.is_admin || teacher.approval_status !== 'approved') redirect('/settings')
  return <CostDashboard />
}
