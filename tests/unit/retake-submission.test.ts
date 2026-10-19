import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/share/[token]/retake/[weekId]/route'
const state=vi.hoisted(()=>({details:[] as unknown[],writeError:false,scoreError:false,writes:0,filters:[] as unknown[][]}))
vi.mock('@/lib/anthropic',()=>({gradeVocabItems:vi.fn(()=>{throw Error('Paid AI must not run')})}))
vi.mock('@/lib/share-access',()=>({resolveShareToken:async()=>({status:'ok',student:{id:'student'}}),canViewShareByStudentId:async()=>true}))
vi.mock('@/lib/supabase/server',()=>({createServiceClient:()=>({from:(table:string)=>{
 let writing=false;const q={select:()=>q,eq:(...args:unknown[])=>{if(table==='student_vocab_answer')state.filters.push(args);return q},is:()=>q,in:()=>q,order:()=>q,limit:()=>q,update:()=>{writing=true;state.writes++;return q},single:()=>q,maybeSingle:()=>q,then:(resolve:(value:unknown)=>unknown)=>{
 let data:unknown=null,error:unknown=null
 if(table==='class_student')data={student_id:'student'}
 if(table==='class')data={archived_at:null}
 if(table==='week_score'){data=writing?[{id:'score'}]:{id:'score'};if(writing&&state.scoreError)error={message:'injected'}}
 if(table==='week')data={class_id:'class'}
 if(table==='student_vocab_answer'){data=writing?[{id:answerId}]:state.details;if(writing&&state.writeError)error={message:'injected'}}
 return Promise.resolve(resolve({data,error}))
 }};return q}})}))
const answerId='00000000-0000-4000-8000-000000000001'
const own={id:answerId,test_source:'example',vocab_word_id:'word',vocab_word:{english_word:'apple',example_sentence:'apple',correct_answer:'사과'},vocab_word_variant:null}
const submit=(answers:unknown)=>POST(new Request('http://localhost/api/retake',{method:'POST',body:JSON.stringify({answers}),headers:{'content-type':'application/json'}}),{params:Promise.resolve({token:'token',weekId:'week'})})
const answer={answer_id:answerId,english_word:'apple',retake_answer:'apple'}
beforeEach(()=>{state.details=[own];state.writeError=false;state.scoreError=false;state.writes=0;state.filters=[]})
describe('retake submission scope and persistence',()=>{
 it('rejects foreign student/week or already-correct IDs before writes',async()=>{state.details=[];expect((await submit([answer])).status).toBe(400);expect(state.writes).toBe(0);expect(state.filters).toContainEqual(['week_score_id','score']);expect(state.filters).toContainEqual(['is_correct',false])})
 it('rejects duplicate IDs',async()=>{expect((await submit([answer,answer])).status).toBe(400);expect(state.writes).toBe(0)})
 it('rejects malformed and empty submissions',async()=>{for(const input of [null,[],[{answer_id:'invalid'}]])expect((await submit(input)).status).toBe(400);expect(state.writes).toBe(0)})
 it('grades blank answers without AI and saves within the score',async()=>{const r=await submit([answer]);expect(r.status).toBe(200);expect((await r.json()).results[0].is_correct).toBe(true);expect(state.filters.filter(x=>x[0]==='week_score_id')).toHaveLength(3)})
 it('does not report success on answer write failure',async()=>{state.writeError=true;expect((await submit([answer])).status).toBe(503);expect(state.writes).toBe(1)})
 it('does not report success on summary write failure',async()=>{state.scoreError=true;expect((await submit([answer])).status).toBe(503)})
})
