/**
 * 해설지 파싱 regression test (실 LLM 호출 — 과금됨. 사용자가 요청할 때만 실행)
 *
 * 사용법:
 *   npx tsx scripts/test-parse.ts <파일경로>            # 파싱 후 golden 과 대조 (없으면 결과만 출력)
 *   npx tsx scripts/test-parse.ts <파일경로> --update   # 결과를 golden 으로 저장
 *   npx tsx scripts/test-parse.ts --all                 # tests/fixtures/*.golden.json 전체 대조
 *   npx tsx scripts/test-parse.ts --all --update        # 전체 golden 갱신
 *
 * 운영 라우트(parse-answers)와 같은 진입점 parseAnswerSheetDocument 를 탄다 —
 * 범위 분할 → 실패 시 통짜 폴백까지 그대로. 예전 하네스는 통짜 parseAnswerSheet 만 불러서
 * 실제 경로와 달랐다.
 *
 * golden 에 담는 것: 문항 식별(번호·소문항) · 채점 계약(style·정답) · 구조 조각(발문/지문/선지).
 * 해설·본문은 담지 않는다 — 문장이 매번 달라져 diff 가 소음이 된다.
 * 픽스처 PDF 는 학교 자료라 커밋하지 않는다 (tests/fixtures/.gitignore). golden 만 커밋.
 */

import fs from 'fs'
import path from 'path'

// .env.local 로드
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadEnv()

process.env.NODE_PATH = path.resolve(process.cwd(), 'src')

// 정적 import 는 호이스팅되어 loadEnv() 보다 먼저 실행된다 — Anthropic 클라이언트가
// 모듈 로드 시점에 키를 읽으므로 반드시 env 를 채운 뒤 동적으로 불러온다.
type ParsedAnswer = import('../src/lib/llm/week').ParsedAnswer
type ParseDocument = typeof import('../src/lib/week-reading-import')['parseAnswerSheetDocument']
let parseAnswerSheetDocument: ParseDocument

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures')

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

function fixtureName(filePath: string) {
  return path.basename(filePath).replace(/\.[^.]+$/, '').replace(/[^\w가-힣.-]/g, '_')
}
const goldenPath = (name: string) => path.join(FIXTURES_DIR, `${name}.golden.json`)

// ── golden 형태 ─────────────────────────────────────────────────────────────

// 선지는 파이프라인의 정규화(parsed-answer-normalize)가 이미 canonical 형태로 맞춘다 —
// 기호 없이 내용만, 단 문장 삽입처럼 기호뿐인 선지는 기호 그대로. 하네스가 또 벗기면
// 삽입 문항이 ["","","","",""] 로 저장돼 diff 가 눈멀게 된다. 그대로 담는다.

type GoldenRow = {
  key: string
  question_number: number
  sub_label: string | null
  question_style: string
  correct_answer: number
  correct_answer_text: string | null
  question_type: string | null
  has_stem: boolean
  has_passage: boolean
  choices: string[] | null
  has_explanation: boolean
}

function toGolden(answers: ParsedAnswer[]): GoldenRow[] {
  return answers
    .map((q) => ({
      key: `${q.question_number}|${q.sub_label ?? ''}`,
      question_number: q.question_number,
      sub_label: q.sub_label ?? null,
      question_style: q.question_style,
      correct_answer: q.correct_answer,
      correct_answer_text: q.correct_answer_text ?? null,
      question_type: q.question_type ?? null,
      has_stem: !!q.question_stem?.trim(),
      has_passage: !!q.passage?.trim(),
      choices: q.choices && q.choices.length > 0 ? q.choices : null,
      has_explanation: !!q.explanation?.trim(),
    }))
    .sort((a, b) => a.question_number - b.question_number || a.key.localeCompare(b.key))
}

// ── 대조 ────────────────────────────────────────────────────────────────────

function diffGolden(expected: GoldenRow[], actual: GoldenRow[]) {
  const issues: string[] = []
  const exp = new Map(expected.map((r) => [r.key, r]))
  const act = new Map(actual.map((r) => [r.key, r]))

  for (const key of exp.keys()) if (!act.has(key)) issues.push(`❌ 문항 사라짐: ${key}`)
  for (const key of act.keys()) if (!exp.has(key)) issues.push(`➕ 문항 생김: ${key}`)

  for (const [key, e] of exp) {
    const a = act.get(key)
    if (!a) continue
    // 채점 계약 — 바뀌면 곧 채점 결과가 바뀐다
    for (const f of ['question_style', 'correct_answer', 'correct_answer_text'] as const) {
      if (e[f] !== a[f]) issues.push(`⚠️  ${key} [${f}]: ${JSON.stringify(e[f])} → ${JSON.stringify(a[f])}`)
    }
    // 구조 조각 — 채워졌던 게 비면 화면(오답노트·다시풀기)이 후퇴한다
    for (const f of ['has_stem', 'has_passage', 'has_explanation'] as const) {
      if (e[f] && !a[f]) issues.push(`⚠️  ${key} [${f}]: 있었는데 비었다`)
    }
    const ec = e.choices?.length ?? 0
    const ac = a.choices?.length ?? 0
    if (ec !== ac) issues.push(`⚠️  ${key} [choices]: ${ec}개 → ${ac}개`)
    else if (ec > 0 && JSON.stringify(e.choices) !== JSON.stringify(a.choices)) {
      issues.push(`ℹ️  ${key} [choices 내용] 달라짐: ${JSON.stringify(a.choices).slice(0, 80)}`)
    }
    if (e.question_type !== a.question_type) {
      issues.push(`ℹ️  ${key} [question_type]: ${e.question_type} → ${a.question_type}`)
    }
  }
  return issues
}

function printTable(rows: GoldenRow[]) {
  console.table(rows.map((r) => ({
    번호: r.key,
    style: r.question_style,
    정답: r.correct_answer || (r.correct_answer_text?.slice(0, 16) ?? '-'),
    유형: r.question_type ?? '-',
    발문: r.has_stem ? '○' : '·',
    지문: r.has_passage ? '○' : '·',
    선지: r.choices ? r.choices.length : '·',
    해설: r.has_explanation ? '○' : '·',
  })))
}

// ── 실행 ────────────────────────────────────────────────────────────────────

async function parseFile(filePath: string): Promise<ParsedAnswer[]> {
  const abs = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(abs)) throw new Error(`파일 없음: ${abs}`)
  const mimeType = MIME[path.extname(abs).toLowerCase()] ?? 'application/pdf'
  const fileData = fs.readFileSync(abs).toString('base64')

  console.log(`⏳ 파싱: ${path.basename(abs)} (${mimeType})`)
  const start = Date.now()
  const { answers, skippedQuestionNumbers } = await parseAnswerSheetDocument(
    [{ fileData, mimeType, fileName: path.basename(abs) }],
  )
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`✅ ${answers.length}문항 (${elapsed}s)${skippedQuestionNumbers?.length ? ` · 결손 ${skippedQuestionNumbers.join(',')}` : ''}`)
  return answers
}

async function runFile(filePath: string, update: boolean): Promise<boolean> {
  const name = fixtureName(filePath)
  const gp = goldenPath(name)
  const actual = toGolden(await parseFile(filePath))

  if (update) {
    fs.writeFileSync(gp, JSON.stringify(actual, null, 2) + '\n', 'utf-8')
    console.log(`💾 golden 저장: ${path.relative(process.cwd(), gp)}`)
    printTable(actual)
    return true
  }
  if (!fs.existsSync(gp)) {
    console.log('ℹ️  golden 없음 — 결과만 출력 (--update 로 저장)')
    printTable(actual)
    return true
  }

  const expected: GoldenRow[] = JSON.parse(fs.readFileSync(gp, 'utf-8'))
  const issues = diffGolden(expected, actual)
  const hard = issues.filter((i) => !i.startsWith('ℹ️'))
  if (issues.length === 0) {
    console.log(`✅ PASS — golden 일치 (${actual.length}문항)`)
    return true
  }
  console.log(`\n${hard.length ? '❌ FAIL' : '✅ PASS (참고 차이만)'} — ${issues.length}개 차이:`)
  issues.forEach((i) => console.log('  ' + i))
  if (hard.length) printTable(actual)
  return hard.length === 0
}

async function main() {
  const args = process.argv.slice(2)
  const update = args.includes('--update')
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY 가 .env.local 에 없습니다'); process.exit(1) }
  ;({ parseAnswerSheetDocument } = await import('../src/lib/week-reading-import'))

  if (args.includes('--all')) {
    const pdfs = fs.readdirSync(FIXTURES_DIR).filter((f) => MIME[path.extname(f).toLowerCase()])
    if (pdfs.length === 0) { console.log('ℹ️  tests/fixtures 에 시험지 파일이 없습니다.'); return }
    let passed = 0, failed = 0
    for (const f of pdfs) {
      console.log(`\n━━━ ${f} ━━━`)
      const ok = await runFile(path.join(FIXTURES_DIR, f), update).catch((e) => { console.error('💥', e?.message ?? e); return false })
      if (ok) passed++
      else failed++
    }
    console.log(`\n결과: ${passed} passed, ${failed} failed`)
    if (failed > 0) process.exit(1)
    return
  }

  const filePath = args.find((a) => !a.startsWith('--'))
  if (!filePath) { console.log('사용법: npx tsx scripts/test-parse.ts <파일경로> [--update] | --all [--update]'); process.exit(1) }
  const ok = await runFile(filePath, update)
  if (!ok) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
