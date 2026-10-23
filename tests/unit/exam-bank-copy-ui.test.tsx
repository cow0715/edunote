// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QuestionCard } from '@/components/exam-bank/question-list'
import { QuestionSearch } from '@/components/exam-bank/question-search'
import type { ExamBankQuestion } from '@/components/exam-bank/types'

const navigation = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation, usePathname: () => '/exam-bank', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/components/exam-bank/question-edit-dialog', () => ({ QuestionEditDialog: () => null }))
// Menu placement is unrelated to clipboard behavior. Keep real menu callbacks and cards.
vi.mock('@/components/ui/dropdown-menu', () => {
  type Props = { children?: ReactNode; onClick?: () => void; disabled?: boolean }
  const Root = ({ children }: Props) => <div data-testid="copy-menu">{children}</div>
  const Content = ({ children }: Props) => <div>{children}</div>
  const Item = ({ children, onClick, disabled }: Props) => <button onClick={onClick} disabled={disabled}>{children}</button>
  return { DropdownMenu: Root, DropdownMenuTrigger: Content, DropdownMenuContent: Content, DropdownMenuItem: Item, DropdownMenuCheckboxItem: Item }
})

type ClipboardPayload = { data: Record<string, Blob> }
let client: QueryClient, written: ClipboardPayload[][]
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
function question(number: number): ExamBankQuestion {
  return {
    id: `q${number}`, exam_bank_id: 'bank', question_number: number, question_type: 'purpose',
    question_text: '다음 글의 목적은?', passage: `Source ${number} starts with a long line\nand continues with **<u>important words</u>**.`,
    choices: ['① First option continues\non this line', '② 둘째', '③ Third', '④ Fourth', '⑤ Fifth'], answer: '①', raw_text: 'untouched source',
    difficulty: null, points: null, correct_rate: null, choice_rates: null,
    explanation_intent: '목적', explanation_translation: '대\n한 요청입니다.',
    explanation_solution: `Solution ${number} depends\non <u>source evidence</u>.`, explanation_vocabulary: 'expand 확대하다\nsource 출처',
    exam_bank: { title: `자료 ${number}`, exam_year: 2026, exam_month: number, grade: 3, source: '모의고사' },
  }
}
const rows = [question(1), question(2), question(3)]
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); written = []
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn(async (items: ClipboardPayload[]) => { written.push(items) }), writeText: vi.fn() } })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') throw new Error('Writes forbidden in copy tests')
    if (url === '/api/exam-bank') return Response.json([])
    if (url.startsWith('/api/exam-bank/questions?')) return Response.json({ data: url.includes('all=1') ? rows : rows.slice(0, 2), total: 3, page: 0, hasMore: false })
    throw new Error(`Unexpected request: ${url}`)
  }))
  window.history.replaceState(null, '', '/exam-bank')
})
afterEach(() => {
  cleanup(); client.clear(); vi.unstubAllGlobals()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})
function show(children: ReactNode) { return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>) }
function menu(button: HTMLElement) { return within(button.closest('[data-testid="copy-menu"]') as HTMLElement) }
async function contents(index: number) {
  await waitFor(() => expect(written.length).toBeGreaterThan(index))
  return { plain: await written[index][0].data['text/plain'].text(), html: await written[index][0].data['text/html'].text() }
}

describe('actual question-bank clipboard entry points', () => {
  it('copies a single problem plus explanation with formatting while its stored/on-screen newlines remain intact', async () => {
    const row = rows[0], before = JSON.stringify(row)
    const view = show(<QuestionCard question={row} />)
    const breaks = view.container.querySelectorAll('br').length
    fireEvent.click(menu(screen.getByRole('button', { name: '문항 복사' })).getByRole('button', { name: '문제 + 해설' }))
    const copied = await contents(0)
    expect(copied.plain).toContain('long line and continues')
    expect(copied.plain).toContain('① First option continues on this line\n② 둘째')
    expect(copied.plain).toContain('Solution 1 depends on source evidence.')
    expect(copied.plain).toContain('대\n한 요청')
    expect(copied.html).toContain('<strong><u>important words</u></strong>')
    expect(copied.html).toContain('<u>source evidence</u>')
    expect(JSON.stringify(row)).toBe(before)
    expect(view.container.querySelectorAll('br').length).toBe(breaks)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('normalizes selected explanation copy and full-result copy, including records outside the visible page', async () => {
    const before = JSON.stringify(rows)
    show(<QuestionSearch />)
    await screen.findByText('2 / 3개 문항 표시')
    fireEvent.click(screen.getAllByRole('checkbox', { name: '선택' })[0])
    const selected = await screen.findByRole('button', { name: /선택 복사/ })
    fireEvent.click(menu(selected).getByRole('button', { name: '해설만' }))
    const first = await contents(0)
    expect(first.plain).toContain('Solution 1 depends on source evidence.')
    expect(first.plain).not.toContain('Solution 2')
    expect(first.html).toContain('<u>source evidence</u>')
    fireEvent.click(menu(screen.getByRole('button', { name: /전체 복사/ })).getByRole('button', { name: '문제+해설' }))
    const all = await contents(1)
    expect(all.plain).toContain('Source 3 starts with a long line and continues')
    expect(all.plain).toContain('Solution 3 depends on source evidence.')
    expect(all.html).toContain('<strong><u>important words</u></strong>')
    expect(JSON.stringify(rows)).toBe(before)
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })
})
