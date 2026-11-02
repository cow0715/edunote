// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { sameDraftField, draftFieldChangedOnServer, gradeDraftSource, readGradeDraftCache, writeGradeDraftCache } from '@/lib/grade-draft-cache'
afterEach(() => localStorage.clear())
it('preserves nullable grades and answers across reloads without publishing them', () => {
 const cache = {savedAt:Date.now(),source:'server',questions:'[]',fields:['s:answers'],rows:[{grade_version:{score_id:null,revision:null},student_id:'s',student_name:'Student',present:true,reading_present:false,reading_correct:null,vocab_correct:0,homework_done:null,memo:'',answers:[{exam_question_id:'q',student_answer:null,student_answer_text:'draft'}]}]}
 expect(writeGradeDraftCache('w',cache)).toBe(true)
 expect(readGradeDraftCache('w')).toEqual(cache)
 expect(readGradeDraftCache('another-week')).toBeNull()
 expect(writeGradeDraftCache('w',null)).toBe(true)
 expect(readGradeDraftCache('w')).toBeNull()
})
it('ignores malformed browser data', () => {
 localStorage.setItem('edunote:grade-input:w','{"rows":null}')
 expect(readGradeDraftCache('w')).toBeNull()
})

it('limits conflict checks to the edited students and excludes contact data', () => {
 const data = {weekScores:[{student_id:'s',reading_correct:0},{student_id:'other',reading_correct:10}],attendance:[{student_id:'s',status:'present'}],classStudents:[{student_id:'s',phone:'private-phone'}]}
 const source = gradeDraftSource(data,['s'])
 expect(source).not.toContain('private-phone')
 expect(source).not.toContain('other')
 expect(gradeDraftSource({...data,weekScores:[data.weekScores[0],{student_id:'other',reading_correct:0}]},['s'])).toBe(source)
})

it('input equality ignores AI verdict changes and retains explicit zero values',()=>{
 const row={grade_version:{score_id:null,revision:null},student_id:'s',student_name:'s',present:true,reading_present:true,reading_correct:0,vocab_correct:null,homework_done:null,memo:'',answers:[{exam_question_id:'q',student_answer:0,is_correct:false}]}
 expect(sameDraftField(row,{...row,answers:[{...row.answers[0],is_correct:true}]},'answers')).toBe(true)
 expect(sameDraftField(row,{...row,answers:[{...row.answers[0],student_answer:null}]},'answers')).toBe(false)
})

it('migrates legacy attendance exclusions without losing cached answers or zero scores',()=>{
 const row={grade_version:{score_id:null,revision:null},student_id:'s',student_name:'s',present:false,reading_present:true,reading_correct:0,vocab_correct:0,homework_done:0,memo:'keep',answers:[{exam_question_id:'q',student_answer:0}]}
 writeGradeDraftCache('w',{savedAt:Date.now(),source:'server',questions:'[]',fields:['s:present','s:answers'],rows:[row]})
 const cached=readGradeDraftCache('w')!
 expect(cached.fields).toEqual(['s:answers'])
 expect(cached.rows[0]).toEqual({...row,present:true})
})

it('attendance changes are not participation conflicts, while null versus zero remains a conflict',()=>{
 const sourceFor=(value:number|null|undefined,status='present')=>{const data={weekScores:value===undefined?[]:[{student_id:'s',reading_correct:value}],attendance:[{student_id:'s',status}]};return gradeDraftSource(data,['s'])}
 const source=sourceFor(0)
 const cache={savedAt:Date.now(),source,questions:'[]',fields:[],rows:[]}
 const absent=sourceFor(0,'absent')
 expect(draftFieldChangedOnServer(cache,absent,'s','present')).toBe(false)
 expect(draftFieldChangedOnServer(cache,absent,'s','reading_present')).toBe(false)
 const unattempted=sourceFor(null)
 expect(draftFieldChangedOnServer(cache,unattempted,'s','reading_present')).toBe(true)
 const noScore={...cache,source:gradeDraftSource({},['s'])}
 expect(draftFieldChangedOnServer(noScore,unattempted,'s','reading_present')).toBe(false)
})
