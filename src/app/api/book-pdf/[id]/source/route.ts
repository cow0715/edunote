import { NextResponse } from 'next/server'
import { err } from '@/lib/api'
import { ownedBook } from '@/lib/book-pdf/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await ownedBook((await params).id)
  if (auth.response) return auth.response
  if (!auth.document!.source_path) return err('원본 파일이 아직 준비되지 않았습니다.', 409)
  const page = Math.max(1, Math.min(auth.document!.manifest?.page_count ?? 1, Number.parseInt(new URL(request.url).searchParams.get('page') ?? '1', 10) || 1))
  const { data, error } = await createServiceClient().storage.from('pdf-import-sources').createSignedUrl(auth.document!.source_path, 600)
  if (error || !data) return err('원본 파일을 열 수 없습니다.', 503)
  const response = NextResponse.redirect(`${data.signedUrl}#page=${page}`)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
