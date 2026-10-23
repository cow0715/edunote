import { getAuth, getTeacherId, err, ok } from '@/lib/api'
import type { SourceImage } from '@/lib/source-region'
export async function GET(request: Request, {params}: {params: Promise<{questionId:string}>}) {
  const {supabase,user}=await getAuth()
  if(!user) return err('인증 필요',401)
  const teacher=await getTeacherId(supabase,user.id)
  if(!teacher) return err('접근 권한 없음',403)
  const {questionId}=await params
  const {data:q}=await supabase.from('exam_bank_question').select('source_images,exam_bank!inner(teacher_id)').eq('id',questionId).eq('exam_bank.teacher_id',teacher).maybeSingle()
  if(!q) return err('문항을 찾을 수 없습니다',404)
  const index=Number(new URL(request.url).searchParams.get('index') ?? '0')
  const images=q.source_images as SourceImage[]
  if(!Number.isInteger(index)||index<0||!Array.isArray(images)||!images[index]?.path?.startsWith('source-images/bank/')) return err('이미지를 찾을 수 없습니다',404)
  const {data,error}=await supabase.storage.from('answer-sheets').createSignedUrl(images[index].path,3600)
  if(error||!data) return err('이미지 조회 실패',500)
  return ok({url:data.signedUrl})
}
