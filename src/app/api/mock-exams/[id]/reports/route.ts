import { getAuth,err,ok } from '@/lib/api'
import { withTeacherTransaction } from '@/lib/db/transaction'
import { saveErrorResponse,SaveError } from '@/lib/db/errors'
import { publishMockReports } from '@/lib/services/mock-reports'

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {user}=await getAuth()
  if(!user) return err('인증 필요',401)
  try {
    const {id}=await params
    const body=await request.json() as {result_id?:string;result_ids?:string[]}
    const resultIds=Array.isArray(body.result_ids)?[...new Set(body.result_ids.filter(id=>typeof id==='string'&&id))]:[]
    if(!resultIds.length&&!body.result_id) throw new SaveError('성적 결과를 선택해 주세요.')
    const reports=await withTeacherTransaction(user.id,context=>publishMockReports(context,id,resultIds.length?resultIds:[body.result_id!]))
    return ok(resultIds.length?{reports,published_count:reports.length}:reports[0])
  } catch(error) { return saveErrorResponse(error) }
}
