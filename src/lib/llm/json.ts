import { jsonrepair, JSONRepairError } from 'jsonrepair'
import { fixUnescapedQuotesInJson } from '../json-lenient'

export function extractJsonArrayCandidate(raw: string): string {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  // A single object can contain passage brackets, so its first '[' is not an array boundary.
  if (cleaned.startsWith('{')) {
    const end = cleaned.lastIndexOf('}')
    const body = end > 0 ? cleaned.slice(0, end + 1) : cleaned
    return `[${body}]`.replace(/^\s*\/\/.*$/gm, '').trim()
  }
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return candidate.replace(/^\s*\/\/.*$/gm, '').trim()
}

export function extractJsonObjectCandidate(raw: string): string {
  const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  return start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
}

function parseWithQuoteRecovery<T>(candidate: string, label: string): T {
  try { return JSON.parse(jsonrepair(candidate)) as T }
  catch (error) {
    try {
      const parsed = JSON.parse(jsonrepair(fixUnescapedQuotesInJson(candidate))) as T
      console.warn(`[${label}] 문자열 안 따옴표 복구 후 파싱 성공`)
      return parsed
    } catch { throw error }
  }
}

export function parseJsonArrayResponse<T>(raw: string, label = 'parseJsonArrayResponse'): T[] {
  const parsed = parseWithQuoteRecovery<T[] | T>(extractJsonArrayCandidate(raw), label)
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function parseJsonObjectResponse<T>(raw: string, label = 'parseJsonObjectResponse'): T {
  return parseWithQuoteRecovery<T>(extractJsonObjectCandidate(raw), label)
}

export function isJsonParseError(error: unknown): boolean {
  if (error instanceof JSONRepairError || error instanceof SyntaxError) return true
  const message = error instanceof Error ? error.message : String(error)
  return /Unexpected (?:character|token|end of JSON|end of input)|JSON at position|is not valid JSON/i.test(message)
}
