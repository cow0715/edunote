// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { GradeScoreValue } from '@/components/grade/grade-score-value'
afterEach(cleanup)
it('keeps an actual zero distinct from a missing score', () => {
 const view = render(<GradeScoreValue correct={0} total={20} participating />)
 expect(screen.getByText('0')).toBeTruthy()
 expect(screen.queryByText('미응시')).toBeNull()
 view.rerender(<GradeScoreValue correct={null} total={20} nullLabel="미응시" />)
 expect(screen.getByText('미응시')).toBeTruthy()
 expect(screen.queryByText('0')).toBeNull()
})
it('never displays a retained old score for an explicitly unattempted exam', () => {
 const view = render(<GradeScoreValue correct={7} total={20} participating={false} />)
 expect(screen.getByText('미응시')).toBeTruthy()
 expect(screen.queryByText('7')).toBeNull()
 view.rerender(<GradeScoreValue correct={null} total={20} participating />)
 expect(screen.getByText('미채점')).toBeTruthy()
})
