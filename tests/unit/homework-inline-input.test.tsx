// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomeworkInlineInput } from '@/components/grade/homework-inline-input'
afterEach(cleanup)
it('keeps decimal typing intact and distinguishes zero from blank',()=>{
 const change=vi.fn(),validity=vi.fn()
 render(<HomeworkInlineInput studentName="학생" value={null} total={6} onChange={change} onValidityChange={validity}/>)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 const input=screen.getByRole('textbox')
 fireEvent.focus(input)
 for(const text of ['2.','2.5','0',''])fireEvent.change(input,{target:{value:text}})
 expect(change.mock.calls.map(call=>call[0])).toEqual([2,2.5,0,null])
 expect(validity).toHaveBeenLastCalledWith(false)
})
it('keeps invalid text visible and does not send invalid values to the row',()=>{
 const change=vi.fn(),validity=vi.fn()
 render(<HomeworkInlineInput studentName="학생" value={2.5} total={6} onChange={change} onValidityChange={validity}/>)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 const input=screen.getByRole('textbox')
 fireEvent.focus(input)
 fireEvent.change(input,{target:{value:'8'}})
 fireEvent.blur(input)
 expect(screen.getByRole('alert')).toBeTruthy()
 expect(screen.queryByRole('textbox')).toBeNull()
 expect(screen.getByRole('button',{name:'학생 숙제 수정'}).textContent).toContain('8')
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('8')
 expect(change).not.toHaveBeenCalled()
 expect(validity).toHaveBeenLastCalledWith(true)
})

it('shows values until clicked and Enter opens only the next student cell',()=>{
 render(<><HomeworkInlineInput studentName="학생1" value={0} total={6} onChange={vi.fn()} onValidityChange={vi.fn()}/><HomeworkInlineInput studentName="학생2" value={null} total={6} onChange={vi.fn()} onValidityChange={vi.fn()}/></>)
 expect(screen.queryByRole('textbox')).toBeNull()
 expect(screen.getByRole('button',{name:'학생1 숙제 수정'}).textContent).toContain('0/ 6')
 expect(screen.getByRole('button',{name:'학생2 숙제 수정'}).textContent).toContain('미기록')
 fireEvent.click(screen.getByRole('button',{name:'학생1 숙제 수정'}))
 fireEvent.keyDown(screen.getByRole('textbox',{name:'학생1 숙제 완료량'}),{key:'Enter'})
 expect(screen.getAllByRole('textbox')).toHaveLength(1)
 expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'학생2 숙제 완료량'}))
})
it('Escape restores the value at the start of editing',()=>{
 const change=vi.fn()
 const {rerender}=render(<HomeworkInlineInput studentName="학생" value={2.5} total={6} onChange={change} onValidityChange={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'4.5'}})
 rerender(<HomeworkInlineInput studentName="학생" value={4.5} total={6} onChange={change} onValidityChange={vi.fn()}/>)
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'})
 expect(change).toHaveBeenLastCalledWith(2.5)
 expect(screen.queryByRole('textbox')).toBeNull()
})

it('does not overwrite a refreshed server value when cancelling an untouched cell',()=>{
 const change=vi.fn()
 const props={studentName:'학생',total:6,onChange:change,onValidityChange:vi.fn()}
 const {rerender}=render(<HomeworkInlineInput {...props} value={2.5}/>)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 rerender(<HomeworkInlineInput {...props} value={4.5}/>)
 fireEvent.keyDown(screen.getByRole('textbox'),{key:'Escape'})
 expect(change).not.toHaveBeenCalled()
 expect(screen.getByRole('button',{name:'학생 숙제 수정'}).textContent).toContain('4.5')
})
