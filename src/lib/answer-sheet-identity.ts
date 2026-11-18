import { createHash } from 'node:crypto'

export function answerSheetCode(weekId: string, studentId: string) {
  const code = createHash('sha256').update(`${weekId}:${studentId}`).digest('hex').slice(0, 10).toUpperCase()
  return `ED-${code.slice(0, 5)}-${code.slice(5)}`
}

export function matchAnswerSheetCode(weekId: string, code: string, candidates: { studentId: string; name: string }[], rawName: string | null) {
  const normalized = code.toUpperCase().replace(/\s/g, '')
  if (!/^ED-[0-9A-F]{5}-[0-9A-F]{5}$/.test(normalized)) return null
  const matches = candidates.filter((candidate) => answerSheetCode(weekId, candidate.studentId) === normalized)
  if (matches.length !== 1) return null

  const match = matches[0]
  const written = rawName?.replace(/\s/g, '')
  if (written && match.name.replace(/\s/g, '') !== written && candidates.some((candidate) => candidate.name.replace(/\s/g, '') === written)) return null
  return match
}
