// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cacheReviewDrafts, clearReviewDraftCache, restoreReviewDrafts } from '@/lib/review-draft-cache'
import type { ExamQuestion } from '@/lib/types'
import type { GradeRow } from '@/hooks/use-grade'
const questions=[{id:'q',question_style:'subjective',correct_answer_text:'model'} as ExamQuestion]
const rows:GradeRow[]=[{student_id:'s',student_name:'가상학생',present:true,reading_present:true,vocab_correct:null,reading_correct:null,homework_done:null,memo:'',answers:[{exam_question_id:'q',student_answer:null,student_answer_text:'answer',needs_review:true,teacher_confirmed:false}]}]
const drafts=new Map([['s_q',{student_id:'s',exam_question_id:'q',is_correct:true}]])
afterEach(()=>{clearReviewDraftCache();vi.useRealTimers();vi.restoreAllMocks()})
it('isolates weeks and restores only unchanged, unconfirmed answers',()=>{
 cacheReviewDrafts('w',drafts,questions,rows)
 expect(restoreReviewDrafts('other',questions,rows).size).toBe(0)
 expect(restoreReviewDrafts('w',questions,rows).size).toBe(1)
 const changed=structuredClone(rows);changed[0].answers[0].student_answer_text='new answer'
 expect(restoreReviewDrafts('w',questions,changed).size).toBe(0)
 cacheReviewDrafts('w',drafts,questions,changed)
 expect(restoreReviewDrafts('w',questions,changed).size).toBe(0)
 const confirmed=structuredClone(rows);confirmed[0].answers[0].teacher_confirmed=true
 expect(restoreReviewDrafts('w',questions,confirmed).size).toBe(0)
 expect(restoreReviewDrafts('w',[{...questions[0],correct_answer_text:'new model'}],rows).size).toBe(0)
})
it('expires drafts after one hour and clears explicit cancellation',()=>{
 vi.useFakeTimers();cacheReviewDrafts('w',drafts,questions,rows)
 vi.advanceTimersByTime(3600001)
 expect(restoreReviewDrafts('w',questions,rows).size).toBe(0)
 cacheReviewDrafts('w',new Map(),questions,rows)
 expect(sessionStorage.getItem('edunote:review-drafts:w')).toBeNull()
})
it('retains the in-memory draft if session storage is unavailable',()=>{
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('storage blocked')})
 cacheReviewDrafts('w',drafts,questions,rows)
 expect(restoreReviewDrafts('w',questions,rows).size).toBe(1)
})
it('ignores corrupted session storage',()=>{
 sessionStorage.setItem('edunote:review-drafts:broken','invalid')
 expect(restoreReviewDrafts('broken',questions,rows).size).toBe(0)
})

it('restores after a fresh module load using this tabs session storage',async()=>{
 cacheReviewDrafts('reload',drafts,questions,rows)
 vi.resetModules()
 const fresh=await import('@/lib/review-draft-cache')
 expect(fresh.restoreReviewDrafts('reload',questions,rows).get('s_q')?.is_correct).toBe(true)
})
