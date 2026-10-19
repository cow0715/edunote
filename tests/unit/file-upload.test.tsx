// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FileUpload } from '@/components/ui/file-upload'

afterEach(cleanup)

describe('shared file selection', () => {
  it('opens the picker without submitting the enclosing form', () => {
    const ref = createRef<HTMLInputElement>()
    const submit = vi.fn()
    render(<form onSubmit={submit}><FileUpload label="시험지 선택" accept=".pdf" inputRef={ref} onChange={vi.fn()} /></form>)
    const click = vi.spyOn(ref.current!, 'click')
    fireEvent.click(screen.getByRole('button', { name: '시험지 선택' }))
    expect(click).toHaveBeenCalledOnce()
    expect(submit).not.toHaveBeenCalled()
  })

  it('routes a dropped file through the existing change handler and preserves its input ref', () => {
    const ref = createRef<HTMLInputElement>()
    const onChange = vi.fn()
    render(<FileUpload label="시험지 선택" accept=".pdf" inputRef={ref} onChange={onChange} />)
    // jsdom does not expose DataTransfer; emulate only the native FileList setter.
    Object.defineProperty(ref.current!, 'files', { configurable: true, writable: true, value: null })
    const files = [new File(['sample'], 'sample.PDF', { type: 'application/pdf' })]
    fireEvent.drop(screen.getByRole('button', { name: '시험지 선택' }), { dataTransfer: { files } })
    expect(onChange).toHaveBeenCalledOnce()
    expect(ref.current!.files?.[0]).toBe(files[0])
  })

  it('rejects unsupported and multiple files before an immediate upload handler can run', () => {
    const onChange = vi.fn()
    render(<FileUpload label="시험지 선택" accept=".pdf" onChange={onChange} />)
    const button = screen.getByRole('button', { name: '시험지 선택' })
    fireEvent.drop(button, { dataTransfer: { files: [new File([''], 'wrong.png', { type: 'image/png' })] } })
    expect(screen.getByRole('alert').textContent).toContain('파일 형식')
    fireEvent.drop(button, { dataTransfer: { files: [new File([''], 'a.pdf'), new File([''], 'b.pdf')] } })
    expect(screen.getByRole('alert').textContent).toContain('한 개씩')
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each([{ disabled: true }, { loading: true }])('blocks drop while unavailable: %j', (state) => {
    const onChange = vi.fn()
    render(<FileUpload label="시험지 선택" accept=".pdf" onChange={onChange} {...state} />)
    fireEvent.drop(screen.getByRole('button', { name: '시험지 선택' }), { dataTransfer: { files: [new File([''], 'a.pdf')] } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves regrading confirmation for both picker and drop', () => {
    const beforeSelect = vi.fn(() => false)
    const onChange = vi.fn()
    const ref = createRef<HTMLInputElement>()
    render(<FileUpload compact label="재채점" accept="image/*" inputRef={ref} beforeSelect={beforeSelect} onChange={onChange} />)
    const click = vi.spyOn(ref.current!, 'click')
    const button = screen.getByRole('button', { name: '재채점' })
    fireEvent.click(button)
    fireEvent.drop(button, { dataTransfer: { files: [new File([''], 'a.png', { type: 'image/png' })] } })
    expect(beforeSelect).toHaveBeenCalledTimes(2)
    expect(click).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })
})

it('a native cancel event leaves the selected filename and change handler untouched', () => {
  const ref = createRef<HTMLInputElement>()
  const onChange = vi.fn()
  render(<FileUpload label="단어장 선택" accept=".xlsx" inputRef={ref} fileName="선택됨.xlsx" onChange={onChange} />)
  fireEvent(ref.current!, new Event('cancel', { bubbles: true }))
  expect(screen.getByText('선택됨.xlsx')).toBeTruthy()
  expect(onChange).not.toHaveBeenCalled()
})
