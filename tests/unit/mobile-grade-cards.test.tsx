// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MobileGradeCards } from '@/components/grade/mobile-grade-cards'
import type { GradeRow } from '@/hooks/use-grade'
afterEach(cleanup)
const row:GradeRow={student_id:'s',student_name:'학생',present:true,reading_present:true,vocab_correct:0,reading_correct:null,homework_done:0,memo:'',answers:[]}
function setup(overrides:Partial<GradeRow>={},saving=false){
 const onUpdate=vi.fn(),onScoreSave=vi.fn(),onOpen=vi.fn()
 render(<MobileGradeCards rows={[{...row,...overrides}]} vocabTotal={20} readingTotal={10} homeworkTotal={5} showExam saving={saving} onUpdate={onUpdate} onScoreSave={onScoreSave} onOpen={onOpen}/>);return {onUpdate,onScoreSave,onOpen}
}
it('shows zero scores and opens the corresponding student sheet',()=>{
 const {onOpen}=setup()
 expect(screen.getByText('0 / 20')).toBeTruthy()
 fireEvent.click(screen.getByRole('button',{name:'학생 단어 답안 열기'}))
 fireEvent.click(screen.getByRole('button',{name:'학생 시험 답안 열기'}))
 expect(onOpen.mock.calls).toEqual([['vocab',0],['exam',0]])
})
it('updates attendance, saves zero/empty homework and memo without AI',()=>{
 const {onUpdate,onScoreSave}=setup()
 fireEvent.click(screen.getByRole('checkbox',{name:'학생 출석'}))
 expect(onUpdate).toHaveBeenCalledWith('s','present',false)
 const homework=screen.getByRole('spinbutton',{name:'학생 숙제 완료량'})
 fireEvent.blur(homework,{target:{value:'0'}})
 expect(onScoreSave).toHaveBeenLastCalledWith(expect.objectContaining({homework_done:0}))
 fireEvent.blur(homework,{target:{value:''}})
 expect(onScoreSave).toHaveBeenLastCalledWith(expect.objectContaining({homework_done:null}))
 fireEvent.blur(screen.getByRole('textbox',{name:'학생 메모'}),{target:{value:'메모 수정'}})
 expect(onScoreSave).toHaveBeenLastCalledWith(expect.objectContaining({memo:'메모 수정'}))
})
it('disables absent student editing and all controls while saving',()=>{
 setup({present:false},true)
 expect((screen.getByRole('button',{name:'학생 시험 답안 열기'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
})
