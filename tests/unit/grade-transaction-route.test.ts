import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { POST } from '@/app/api/weeks/[id]/grade/route'
import { SaveError } from '@/lib/db/errors'

const state=vi.hoisted(()=>({events:[] as string[],save:vi.fn(),ai:vi.fn(),from:vi.fn(),capture:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/api',()=>({
  getAuth:async()=>({user:{id:'user'},supabase:{from:state.from}}),getTeacherId:async()=>'teacher',assertWeekOwner:async()=>true,
  err:(message:string,status=400)=>Response.json({error:message},{status}),
  ok:(data:unknown)=>Response.json(data),
}))
vi.mock('@/lib/anthropic',()=>({gradeSubjectiveAnswers:state.ai}))
vi.mock('@/lib/services/week-save',()=>({
  captureWeekVersion:state.capture,
  saveWeekPlan:state.save,
  readingTotals:()=>[],
}))
const week='00000000-0000-4000-8000-000000000031'
const student='00000000-0000-4000-8000-000000000041'
const question='00000000-0000-4000-8000-000000000061'
const body=[{student_id:student,student_name:'synthetic',present:true,vocab_correct:null,reading_present:true,
  reading_correct:0,homework_done:null,memo:'',answers:[{exam_question_id:question,student_answer:null,student_answer_text:'answer'}]}]
const invoke=()=>POST(new Request('http://localhost/grade',{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({id:week})})
beforeEach(()=>{
  vi.clearAllMocks()
  state.events=[]
  state.capture.mockImplementation(async()=>{state.events.push('capture');return 'version'})
  state.from.mockImplementation((table:string)=>({select:()=>({eq:async()=>({error:null,data:table==='week_score'?[]:[{
    id:question,question_number:1,sub_label:null,question_style:'subjective',correct_answer:0,correct_answer_text:'answer',grading_criteria:null,
  }]})})}))
  state.ai.mockImplementation(async(_questions,answers)=>{state.events.push('ai');return [{
    week_score_id:answers[0].week_score_id,exam_question_id:question,is_correct:true,needs_review:false,ai_feedback:'correct',
  }]})
  state.save.mockImplementation(async()=>{state.events.push('save')})
})

describe('grading transaction boundary',()=>{
  it('runs AI before the sole persistence call and queues score plus answer together',async()=>{
    const response=await invoke()
    expect(response.status).toBe(200)
    expect(state.events).toEqual(['capture','ai','save'])
    expect(state.save).toHaveBeenCalledOnce()
    const [userId,weekId,version,statements,students]=state.save.mock.calls[0]
    expect([userId,weekId,version,students]).toEqual(['user',week,'version',[student]])
    const dialect=new PgDialect()
    const queries=statements.map((statement:{query:Parameters<PgDialect['sqlToQuery']>[0]})=>dialect.sqlToQuery(statement.query).sql)
    expect(queries.some((query:string)=>query.includes('insert into "public"."week_score"'))).toBe(true)
    expect(queries.some((query:string)=>query.includes('insert into "public"."student_answer"'))).toBe(true)
    expect(queries.some((query:string)=>query.includes('update "public"."student_answer"'))).toBe(true)
  })
  it('saves the base grade atomically with an explicit AI failure result',async()=>{
    state.ai.mockRejectedValue(new Error('synthetic AI failure'))
    const response=await invoke()
    expect(await response.json()).toMatchObject({ok:true,ai_grading_failed:true})
    expect(state.save).toHaveBeenCalledOnce()
  })
  it('returns 409 if grading inputs changed while AI was running',async()=>{
    state.save.mockRejectedValue(new SaveError('자료가 변경됐습니다.',409))
    const response=await invoke()
    expect(response.status).toBe(409)
    expect(state.ai).toHaveBeenCalledOnce()
    expect(state.save).toHaveBeenCalledOnce()
  })
  it('rejects foreign question identifiers before AI or persistence',async()=>{
    state.from.mockImplementation(()=>({select:()=>({eq:async()=>({data:[],error:null})})}))
    const response=await invoke()
    expect(response.status).toBe(403)
    expect(state.ai).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
  })
})
