// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MobileGradeCards } from '@/components/grade/mobile-grade-cards'
import type { GradeRow } from '@/hooks/use-grade'
afterEach(cleanup)
const row:GradeRow={grade_version:{score_id:null,revision:'a'.repeat(64)},student_id:'s',student_name:'학생',present:true,reading_present:true,vocab_correct:0,reading_correct:null,homework_done:0,memo:'',answers:[]}
function setup(overrides:Partial<GradeRow>={},saving=false){
 const onUpdate=vi.fn(),onScoreSave=vi.fn(),onOpen=vi.fn()
 render(<MobileGradeCards rows={[{...row,...overrides}]} vocabTotal={20} readingTotal={10} homeworkTotal={5} showExam saving={saving} onUpdate={onUpdate} onScoreSave={onScoreSave} onOpen={onOpen}/>);return {onUpdate,onScoreSave,onOpen}
}
it('shows zero scores and opens the corresponding student sheet',()=>{
 const {onOpen}=setup()
 expect(screen.getByRole('button',{name:'학생 단어 답안 열기'}).textContent).toContain('0/ 20')
 fireEvent.click(screen.getByRole('button',{name:'학생 단어 답안 열기'}))
 fireEvent.click(screen.getByRole('button',{name:'학생 시험 답안 열기'}))
 expect(onOpen.mock.calls).toEqual([['vocab',0],['exam',0]])
})
it('stages decimal and empty homework inline without calling save or AI',()=>{
 const {onUpdate,onScoreSave}=setup()
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.change(screen.getByRole('textbox',{name:'학생 숙제 완료량'}),{target:{value:'2.5'}})
 expect(onUpdate).toHaveBeenLastCalledWith('s','homework_done',2.5)
 fireEvent.change(screen.getByRole('textbox',{name:'학생 숙제 완료량'}),{target:{value:''}})
 expect(onUpdate).toHaveBeenLastCalledWith('s','homework_done',null)
 expect(onScoreSave).not.toHaveBeenCalled()
 fireEvent.blur(screen.getByRole('textbox',{name:'학생 메모'}),{target:{value:'메모 수정'}})
 expect(onScoreSave).toHaveBeenLastCalledWith(expect.objectContaining({memo:'메모 수정'}))
})
it('disables absent student editing and all controls while saving',()=>{
 setup({present:false},true)
 expect((screen.getByRole('button',{name:'학생 시험 답안 열기'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
})

it('shows attendance as a status rather than an editable control or per-student manager button',()=>{
 render(<MobileGradeCards rows={[row]} vocabTotal={20} readingTotal={10} homeworkTotal={5} showExam saving={false} onOpenAttendance={vi.fn()} attendanceStatuses={new Map([['s','absent']])} onUpdate={vi.fn()} onScoreSave={vi.fn()} onOpen={vi.fn()}/>)
 expect(screen.getByLabelText('학생 출결 상태').textContent).toBe('결석')
 expect(screen.queryByRole('combobox')).toBeNull()
 expect(screen.queryByRole('button',{name:'출결 관리'})).toBeNull()
 expect(screen.getByRole('button',{name:'학생 단어 답안 열기'}).textContent).toContain('0/ 20')
})
