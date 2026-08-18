/**
 * API 테스트 하네스 (재사용 레이어)
 *
 * 라우트별 테스트가 3~4줄로 끝나도록 여기에 전부 몰아넣는다:
 *   - .env.local 로딩
 *   - 개발 DB 접속 (fixture 조회 전용)
 *   - HTTP 호출 + 응답 검증
 *   - 사전 조건 확인 (서버가 떠 있나, 쓸 데이터가 있나)
 *
 * 실행: 개발 서버가 떠 있어야 한다.
 *   터미널 1) npm run dev
 *   터미널 2) npm run test:api
 *
 * 사전 조건이 없으면 실패가 아니라 skip 한다. 다만 **왜 건너뛰었는지 반드시 출력한다** —
 * 조용히 초록불이 뜨면 "다 통과했다"로 오해하게 된다.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { z } from 'zod'
import { expect } from 'vitest'

// ── 환경 ────────────────────────────────────────────────────────────────────

let envLoaded = false

export function loadEnvLocal() {
  if (envLoaded) return
  envLoaded = true
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^["']|["']$/g, '')
  }
}

export function baseUrl() {
  return process.env.TEST_BASE_URL ?? 'http://localhost:3000'
}

// ── 개발 DB (fixture 조회 전용) ───────────────────────────────────────────────
//
// 서비스 롤을 쓰지만 **읽기만 한다.** 이 하네스는 데이터를 만들거나 지우지 않는다.
// 운영 DB를 가리키지 않도록 .env.local(개발 DB)만 읽는다.

let cachedDb: SupabaseClient | null = null

export function db(): SupabaseClient {
  loadEnvLocal()
  if (cachedDb) return cachedDb
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('.env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  cachedDb = createClient(url, key, { auth: { persistSession: false } })
  return cachedDb
}

// ── HTTP ────────────────────────────────────────────────────────────────────

export type JsonResponse = { status: number; body: unknown; raw: string }
export type PageResponse = { status: number; html: string }

/**
 * redirect: 'manual' 이 중요하다.
 * 미인증 API 요청은 proxy.ts 가 /login 으로 307 리다이렉트하는데,
 * 기본값(follow)이면 로그인 페이지 HTML 을 200 으로 받아버려서
 * "보호된 라우트가 200 을 준다"고 오해하게 된다.
 */
export async function apiGet(pathname: string): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl()}${pathname}`, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
  })
  const raw = await response.text()
  let body: unknown = null
  try {
    body = JSON.parse(raw)
  } catch {
    // JSON 이 아니면 body 는 null 로 두고 raw 로 확인한다 (HTML 에러 페이지 등)
  }
  return { status: response.status, body, raw }
}

/** 서버 렌더링 페이지 — 200 으로 잘 그려지는지만 본다 */
export async function pageGet(pathname: string): Promise<PageResponse> {
  const response = await fetch(`${baseUrl()}${pathname}`, { redirect: 'manual' })
  return { status: response.status, html: await response.text() }
}

// ── 응답 검증 ────────────────────────────────────────────────────────────────

/**
 * 200 + 스키마 일치를 한 번에 확인하고, 파싱된 값을 돌려준다.
 * 스키마가 안 맞으면 zod 가 어느 필드가 왜 틀렸는지 알려준다.
 */
export function expectJson<T>(response: JsonResponse, schema: z.ZodType<T>): T {
  expect(response.status, `기대 200, 실제 ${response.status} — 본문: ${response.raw.slice(0, 300)}`).toBe(200)
  const parsed = schema.safeParse(response.body)
  if (!parsed.success) {
    throw new Error(`응답 형태 불일치:\n${JSON.stringify(parsed.error.issues, null, 2)}`)
  }
  return parsed.data
}

/** 잘못된 입력에 대해 4xx 로 답하는지 (500 으로 터지지 않는지) */
export function expectClientError(response: JsonResponse) {
  expect(
    response.status >= 400 && response.status < 500,
    `4xx 를 기대했지만 ${response.status} — 본문: ${response.raw.slice(0, 300)}`,
  ).toBe(true)
}

// ── 사전 조건 ────────────────────────────────────────────────────────────────

export type Prerequisites = {
  serverUp: boolean
  reasons: string[]
}

export async function checkServer(): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl()}/login`, { signal: AbortSignal.timeout(5000) })
    return response.status < 500
  } catch {
    return false
  }
}

/**
 * DB가 살아있는지 먼저 확인한다.
 *
 * 이게 없으면 "DB가 통째로 죽음"과 "데이터가 없음"을 구분하지 못한다.
 * 실제로 개발 DB가 삭제됐는데 하네스가 "공유 토큰 없음"이라고 보고해서
 * 초록불처럼 보인 적이 있다. 조용한 초록불이 제일 위험하다.
 */
export async function checkDb(): Promise<{ reachable: boolean; reason?: string }> {
  try {
    const { error } = await db().from('student').select('id', { head: true, count: 'exact' })
    if (error) return { reachable: false, reason: error.message }
    return { reachable: true }
  } catch (e) {
    return { reachable: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/** skip 사유를 눈에 띄게 출력한다 — 조용한 초록불 방지 */
export function announceSkip(what: string, why: string) {
  console.warn(`  [SKIP] ${what} — ${why}`)
}

/** 실행 전에 무엇이 빠졌는지 한눈에 보여준다 */
export function announcePrerequisites(entries: { label: string; ok: boolean; detail?: string }[]) {
  const missing = entries.filter((e) => !e.ok)
  if (missing.length === 0) return
  console.warn('\n' + '='.repeat(70))
  console.warn('  사전 조건이 빠져서 일부 테스트를 건너뜁니다. 초록불 = 전부 검증됨이 아닙니다.')
  for (const entry of missing) {
    console.warn(`   · ${entry.label}${entry.detail ? ` — ${entry.detail}` : ''}`)
  }
  console.warn('='.repeat(70) + '\n')
}

// ── fixture 조회 ─────────────────────────────────────────────────────────────
//
// 데이터를 만들지 않고 개발 DB에 이미 있는 것을 찾아 쓴다.
// 없으면 null 을 돌려주고, 호출부는 skip 한다.

/**
 * 조회 에러를 절대 삼키지 않는다.
 * `const { data } = await ...` 로 error 를 무시하면 접속 실패가 "데이터 없음"으로 둔갑한다.
 */
async function must<T>(label: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw new Error(`${label} 조회 실패: ${error.message}`)
  return data
}

/**
 * 재원 중인(class_student.left_at 이 null 인) 학생의 공유 토큰을 찾는다.
 * 퇴원 학생 토큰은 API 가 403 을 주므로 정상 경로 테스트에 쓸 수 없다.
 */
export async function findShareToken(): Promise<string | null> {
  const rows = await must(
    '재원 학생',
    db().from('class_student').select('student(share_token)').is('left_at', null).limit(50),
  )

  for (const row of rows ?? []) {
    const student = row.student as { share_token: string | null } | { share_token: string | null }[] | null
    const token = (Array.isArray(student) ? student[0] : student)?.share_token
    if (token) return token
  }
  return null
}

export async function findPublishedReportCardToken(): Promise<string | null> {
  const rows = await must(
    '발행된 성적표',
    db().from('report_card').select('share_token').eq('status', 'published').not('share_token', 'is', null).limit(1),
  )
  return (rows?.[0]?.share_token as string | undefined) ?? null
}

export async function findPublishedMockExamReportToken(): Promise<string | null> {
  const rows = await must(
    '발행된 모의고사 리포트',
    db().from('mock_exam_report').select('share_token').eq('status', 'published').not('share_token', 'is', null).limit(1),
  )
  return (rows?.[0]?.share_token as string | undefined) ?? null
}

/** 존재하지 않는 토큰 — 형식은 그럴듯하지만 DB에 없다 */
export const MISSING_TOKEN = 'harness-nonexistent-token-0000'
