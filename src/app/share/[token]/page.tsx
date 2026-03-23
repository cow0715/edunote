import { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import ShareClient from './share-client'

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const { token } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('student')
    .select('name')
    .eq('share_token', token)
    .single()

  return {
    title: data?.name ? `${data.name} 학습 현황` : '학습 현황',
  }
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  return <ShareClient params={params} />
}
