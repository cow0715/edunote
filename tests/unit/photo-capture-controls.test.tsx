// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VocabPhotoButton } from '@/components/grade/vocab-photo-button'
import { ExamPhotoButton } from '@/components/grade/exam-photo-button'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('separates camera and library without sending a paid request merely on picker click', () => {
 const fetch = vi.fn(); vi.stubGlobal('fetch',fetch)
 const {container}=render(<ExamPhotoButton weekId="w" disabled={false} onResult={vi.fn()}/>)
 const inputs=container.querySelectorAll('input[type=file]')
 expect(inputs[0].getAttribute('capture')).toBe('environment')
 expect(inputs[1].hasAttribute('capture')).toBe(false)
 fireEvent.click(screen.getByRole('button',{name:'카메라로 촬영'}))
 fireEvent.click(screen.getByRole('button',{name:'사진 선택'}))
 expect(fetch).not.toHaveBeenCalled()
})
it('preserves overwrite confirmation on both camera and file paths', () => {
 vi.stubGlobal('fetch',vi.fn())
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 const click=vi.spyOn(HTMLInputElement.prototype,'click')
 render(<VocabPhotoButton weekId="w" studentId="s" disabled={false} hasExistingData onResult={vi.fn()}/>)
 fireEvent.click(screen.getByRole('button',{name:'카메라로 촬영 채점'}))
 fireEvent.click(screen.getByRole('button',{name:'파일로 재채점'}))
 expect(confirm).toHaveBeenCalledTimes(2)
 expect(click).not.toHaveBeenCalled()
 expect(fetch).not.toHaveBeenCalled()
})
it('disables both capture paths when unavailable', () => {
 render(<VocabPhotoButton weekId="w" studentId="s" disabled hasExistingData={false} onResult={vi.fn()}/>)
 expect((screen.getByRole('button',{name:'카메라로 촬영 채점'}) as HTMLButtonElement).disabled).toBe(true)
 expect((screen.getByRole('button',{name:'사진·PDF 선택 채점'}) as HTMLButtonElement).disabled).toBe(true)
})
