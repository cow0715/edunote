import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({save:vi.fn(), insert:vi.fn(), remove:vi.fn(), ai:vi.fn(),scoreExists:true, capture:vi.fn(), immediate:vi.fn(), rest:vi.fn(), teacher:vi.fn(), owner:vi.fn(), authenticated:true}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/api',()=>({
 getAuth:async()=>({user:state.authenticated?{id:'user'}:null,supabase:{from:(table:string)=>{
 state.rest(table)
 const query = {select:()=>query,eq:()=>query,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='week_score'?(state.scoreExists?[{id:'score',student_id:'s'}]:[]):[{id:'q',question_number:1,question_style:'subjective',correct_answer_text:'model'}],error:null}).then(resolve)}
 return query
 }}}),getTeacherId:state.teacher,assertWeekOwner:state.owner,
 ok:(value:unknown,init?:ResponseInit)=>Response.json(value,init),err:(error:string,status=400)=>Response.json({error},{status}),
}))
vi.mock('@/lib/services/week-save',()=>({captureWeekVersion:state.capture,saveWeekPlan:state.save,readingTotals:()=>[],saveImmediateWeekPlan:state.immediate}))
vi.mock('@/lib/db/statements',()=>({insertRows:state.insert,deleteRows:state.remove,updateRows:()=>({})}))
vi.mock('@/lib/anthropic',()=>({gradeSubjectiveAnswers:state.ai}))
vi.mock('@/lib/services/grade-save',async importOriginal=>({...await importOriginal<typeof import('@/lib/services/grade-save')>(),
 captureGradeVersions:async(_user:string,_week:string,ids:string[])=>ids.map(student_id=>({student_id,score_id:null,revision:'a'.repeat(64)})),
 saveGradePlan:state.save,
 applyGradePlan:async(_context:unknown,_week:string,_version:unknown,_statements:unknown,ids:string[])=>({ok:true,versions:ids.map(student_id=>({student_id,score_id:null,revision:'b'.repeat(64)}))}),
}))
import { POST } from '@/app/api/weeks/[id]/grade/route'
beforeEach(()=>{state.scoreExists=true;state.authenticated=true;vi.clearAllMocks();state.teacher.mockResolvedValue('teacher');state.owner.mockResolvedValue(true);state.insert.mockReturnValue([]);state.ai.mockResolvedValue([]);state.capture.mockResolvedValue('version');state.immediate.mockImplementation(async(_user,_week,_students,prepare)=>prepare({tx:{execute:async()=>({rows:[{scores:state.scoreExists?[{id:'score',student_id:'s'}]:[],questions:[{id:'q',question_number:1,question_style:'subjective',correct_answer_text:'model'}]}]})}}))})
const row = {grade_version:{score_id:null,revision:'a'.repeat(64)},student_id:'s',student_name:'Student',present:true,reading_present:true,reading_correct:0,vocab_correct:0,homework_done:0,memo:'stale memo',answers:[{exam_question_id:'q',student_answer:null,student_answer_text:'draft',is_correct:false}]}
async function send(value:unknown){return POST(new Request('http://localhost/api/weeks/w/grade',{method:'POST',body:JSON.stringify(value)}),{params:Promise.resolve({id:'w'})})}
it('background exam drafts cannot overwrite other scores or call an LLM',async()=>{
 const response=await send({rows:[row],skip_ai:true,draft_only:true})
 expect(response.status).toBe(200)
 expect(state.ai).not.toHaveBeenCalled()
 expect(state.immediate).toHaveBeenCalledOnce()
 expect(state.capture).not.toHaveBeenCalled()
 expect(state.save).not.toHaveBeenCalled()
 expect(state.rest).not.toHaveBeenCalled()
 expect(state.teacher).not.toHaveBeenCalled()
 expect(state.owner).not.toHaveBeenCalled()
 const score=state.insert.mock.calls.find(call=>call[0]==='week_score')![1][0]
 expect(score).toMatchObject({student_id:'s',reading_correct:0})
 expect(score).not.toHaveProperty('vocab_correct')
 expect(score).not.toHaveProperty('homework_done')
 expect(score).not.toHaveProperty('memo')
 expect(response.headers.get('Server-Timing')).toMatch(/snapshot;dur=.*read;dur=.*commit;dur=/)
})
it('retains explicit nonparticipation and never deletes a result in background mode',async()=>{
 await send({rows:[{...row,reading_present:false,reading_correct:8}],skip_ai:true,draft_only:true})
 expect(state.insert.mock.calls.find(call=>call[0]==='week_score')![1][0].reading_correct).toBeNull()
 expect(state.insert.mock.calls.some(call=>call[0]==='student_answer')).toBe(false)
 await send({rows:[{...row,present:false}],skip_ai:true,draft_only:true})
 expect(state.remove).not.toHaveBeenCalled()
})
it('keeps full-save score fields but never deletes legacy excluded records',async()=>{
 await send({rows:[{...row,answers:[]}],skip_ai:false})
 expect(state.insert.mock.calls.find(call=>call[0]==='week_score')![1][0]).toMatchObject({vocab_correct:0,homework_done:0,memo:'stale memo'})
 await send({rows:[{...row,present:false}],skip_ai:false})
 expect(state.remove).not.toHaveBeenCalled()
})

it('initializes unattempted vocabulary and homework as null for a new exam draft',async()=>{
 state.scoreExists=false
 const response=await send({rows:[row],skip_ai:true,draft_only:true})
 expect(response.status).toBe(200)
 expect(state.insert.mock.calls.find(call=>call[0]==='week_score')![1][0]).toMatchObject({vocab_correct:null,homework_done:null,memo:null})
})

it('propagates atomic draft failure so the client retains its unsaved answers',async()=>{
 state.immediate.mockRejectedValueOnce(new Error('injected transaction failure'))
 expect((await send({rows:[row],skip_ai:true,draft_only:true})).status).toBe(503)
 expect(state.save).not.toHaveBeenCalled()
 expect(state.ai).not.toHaveBeenCalled()
})

it('rejects an unauthenticated draft before opening a transaction',async()=>{
 state.authenticated=false
 expect((await send({rows:[row],skip_ai:true,draft_only:true})).status).toBe(401)
 expect(state.immediate).not.toHaveBeenCalled()
})
it('retains the existing full-save authorization before planning',async()=>{
 state.owner.mockResolvedValue(false)
 expect((await send({rows:[row],skip_ai:false})).status).toBe(403)
 expect(state.owner).toHaveBeenCalledOnce()
 expect(state.capture).not.toHaveBeenCalled()
 expect(state.immediate).not.toHaveBeenCalled()
})
