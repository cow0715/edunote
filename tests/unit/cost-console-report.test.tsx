// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ClaudeConsoleReport } from '@/app/(admin)/settings/costs/claude-console-report'
import { costReportFixture } from '../fixtures/cost-report'
afterEach(cleanup)
describe('console-style history and coverage', () => {
  it('shows source coverage, keyboard day selection and a daily table without inventing future days', () => {
    render(<ClaudeConsoleReport report={costReportFixture()} tail={[]} />)
    expect(screen.getByText('비용 API에 집계된 금액')).toBeTruthy()
    expect(screen.getByText('그 이후 조직 사용량 환산')).toBeTruthy()
    fireEvent.focus(screen.getByRole('button', { name: '2026-10-01 업체 조회액 US$1.00' }))
    expect(screen.getByText(/2026-10-01 · 업체 조회액/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '표' }))
    const daily = screen.getAllByRole('table')[0]
    expect(within(daily).getByText('미집계')).toBeTruthy()
    expect(within(daily).queryByText('2026-10-03')).toBeNull()
    expect(screen.getByText('claude-sonnet-5')).toBeTruthy()
  })
})
