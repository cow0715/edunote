import { describe, expect, it } from 'vitest'
import { readablePassage } from '@/lib/material-display'

describe('readable textbook passages', () => {
  it('reflows narrow PDF column wraps while keeping letter and paragraph structure', () => {
    const input = 'Dear students,\nI am writing to you about our school clubs. Over\nthe last few semesters, there have been requests\nfor more diverse school clubs.\n\nBest regards,\nAmanda Clark'
    expect(readablePassage(input)).toBe('Dear students,\nI am writing to you about our school clubs. Over the last few semesters, there have been requests for more diverse school clubs.\n\nBest regards,\nAmanda Clark')
  })
  it('preserves tables, aligned rows, lists, labels and emphasis', () => {
    for (const source of ['Name\tScore\nAlice\t10', '| Name | Score |\n| Alice | 10 |', 'Name    Score\nAlice    10', '(A) First section\n(B) Second section', '① first\n② second']) {
      expect(readablePassage(source)).toBe(source)
    }
    expect(readablePassage('This **<u>important</u>** text\ncontinues here.')).toBe('This **<u>important</u>** text continues here.')
  })
  it('does not change source characters or invent missing visual content', () => {
    const input = 'An ___ gap remains\nin this sentence.\n\n[Figure 1]'
    expect(readablePassage(input).replace(/\s/g, '')).toBe(input.replace(/\s/g, ''))
  })
})
