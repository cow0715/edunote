// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HomeworkScoreEditor } from '@/components/grade/homework-score-editor'
afterEach(cleanup)
function setup(value:number|null=null,onSave=vi.fn().mockResolvedValue(undefined)){
 render(<HomeworkScoreEditor studentName="학생" value={value} total={6} onSave={onSave}/>)
 return onSave
}
it('distinguishes an unrecorded value from a real zero in its compact display',()=>{
 const {unmount}=render(<HomeworkScoreEditor studentName="학생" value={null} total={6} onSave={async()=>{}}/>)
 expect(screen.getByRole('button',{name:'학생 숙제 수정'}).textContent).toContain('미기록')
 unmount()
 setup(0)
 expect(screen.getByRole('button',{name:'학생 숙제 수정'}).textContent).toContain('0/ 6')
 expect(screen.queryByText('미기록')).toBeNull()
})
it('saves fractional values without rounding or converting an empty input to zero',async()=>{
 const save=setup()
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.change(screen.getByRole('spinbutton',{name:'학생 숙제 완료량'}),{target:{value:'3.5'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(save).toHaveBeenCalledWith(3.5))
 await waitFor(()=>expect(screen.queryByRole('spinbutton')).toBeNull())
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(save).toHaveBeenLastCalledWith(null))
})
it('quick choices save null, zero and the full total distinctly',async()=>{
 const save=setup(2.5)
 for(const [label,value] of [['미제출',0],['미기록',null],['완료',6]] as const){
  fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
  fireEvent.click(screen.getByRole('button',{name:label}))
  await waitFor(()=>expect(save).toHaveBeenLastCalledWith(value))
  await waitFor(()=>expect(screen.queryByRole('spinbutton')).toBeNull())
 }
})
it('retains a failed fractional input and retries it without changing its value',async()=>{
 const save=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
 setup(1,save)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.change(screen.getByRole('spinbutton',{name:'학생 숙제 완료량'}),{target:{value:'2.5'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await screen.findByRole('alert')
 expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('2.5')
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await waitFor(()=>expect(save).toHaveBeenCalledTimes(2))
 expect(save.mock.calls.map(call=>call[0])).toEqual([2.5,2.5])
})
it('cancels without saving and rejects out-of-range input',async()=>{
 const save=setup(2.5)
 fireEvent.click(screen.getByRole('button',{name:'학생 숙제 수정'}))
 fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'7'}})
 fireEvent.click(screen.getByRole('button',{name:'저장'}))
 await screen.findByRole('alert')
 expect(save).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'취소'}))
 expect(save).not.toHaveBeenCalled()
})
