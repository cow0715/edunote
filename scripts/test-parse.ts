/**
 * 해설지 파싱 regression test
 *
 * 사용법:
 *   npx tsx scripts/test-parse.ts <파일경로>          # 파싱 후 결과 출력
 *   npx tsx scripts/test-parse.ts <파일경로> --update # 결과를 golden file로 저장
 *   npx tsx scripts/test-parse.ts --all               # tests/fixtures/ 전체 검증
 *
 * 예:
 *   npx tsx scripts/test-parse.ts "용산고 교과서 2과 진단평가(0324).pdf" --update
 *   npx tsx scripts/test-parse.ts --all
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

// src/ 경로 alias 처리 (tsx에서 @/ 못 읽을 경우 대비)
process.env.NODE_PATH = path.resolve(process.cwd(), 'src')

import { parseAnswerSheet } from '../src/lib/anthropic'

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures')

function getFixtureName(filePath: string) {
  return path.basename(filePath).replace(/[^\w가-힣.-]/g, '_')
}

function getGoldenPath(fixtureName: string) {
  return path.join(FIXTURES_DIR, `${fixtureName}.golden.json`)
}

async function runParse(filePath: string) {
  const abs = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(abs)) {
    console.error(`❌ 파일 없음: ${abs}`)
    process.exit(1)
  }
  const buf = fs.readFileSync(abs)
  const base64 = buf.toString('base64')
  const ext = path.extname(abs).toLowerCase()
  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  const mimeType = mimeMap[ext] ?? 'application/pdf'

  console.log(`⏳ 파싱 중: ${path.basename(abs)} (${mimeType})`)
  const start = Date.now()
  const result = await parseAnswerSheet(base64, mimeType)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`✅ ${result.length}문항 파싱 완료 (${elapsed}s)`)
  return result
}

function diffResults(expected: ReturnType<typeof normalizeResult>, actual: ReturnType<typeof normalizeResult>) {
  const issues: string[] = []
  const expMap = new Map(expected.map((q) => [`${q.question_number}|${q.sub_label ?? ''}`, q]))
  const actMap = new Map(actual.map((q) => [`${q.question_number}|${q.sub_label ?? ''}`, q]))

  // 추가/삭제된 문항
  for (const key of expMap.keys()) {
    if (!actMap.has(key)) issues.push(`❌ 문항 삭제됨: ${key}`)
  }
  for (const key of actMap.keys()) {
    if (!expMap.has(key)) issues.push(`➕ 문항 추가됨: ${key}`)
  }

  // 변경된 필드
  for (const [key, exp] of expMap) {
    const act = actMap.get(key)
    if (!act) continue
    const fields: Array<keyof typeof exp> = ['question_style', 'correct_answer', 'correct_answer_text']
    for (const f of fields) {
      if (exp[f] !== act[f]) {
        issues.push(`⚠️  ${key} [${f}]: "${exp[f]}" → "${act[f]}"`)
      }
    }
  }
  return issues
}

function normalizeResult(result: Awaited<ReturnType<typeof parseAnswerSheet>>) {
  return result.map((q) => ({
    question_number: q.question_number,
    sub_label: q.sub_label,
    question_style: q.question_style,
    correct_answer: q.correct_answer,
    correct_answer_text: q.correct_answer_text,
  }))
}

async function runFile(filePath: string, update: boolean) {
  const name = getFixtureName(filePath)
  const goldenPath = getGoldenPath(name)
  const result = await runParse(filePath)
  const normalized = normalizeResult(result)

  if (update) {
    fs.writeFileSync(goldenPath, JSON.stringify(normalized, null, 2), 'utf-8')
    console.log(`💾 golden 저장: ${goldenPath}`)
    console.table(normalized.map((q) => ({
      번호: q.question_number,
      sub: q.sub_label ?? '-',
      style: q.question_style,
      correct: q.correct_answer,
      text: q.correct_answer_text?.slice(0, 20) ?? '-',
    })))
    return true
  }

  if (!fs.existsSync(goldenPath)) {
    console.log(`ℹ️  golden 없음 — 결과만 출력합니다 (--update로 저장)`)
    console.table(normalized.map((q) => ({
      번호: q.question_number,
      sub: q.sub_label ?? '-',
      style: q.question_style,
      correct: q.correct_answer,
      text: q.correct_answer_text?.slice(0, 20) ?? '-',
    })))
    return true
  }

  const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf-8'))
  const issues = diffResults(expected, normalized)

  if (issues.length === 0) {
    console.log(`✅ PASS — golden과 일치 (${normalized.length}문항)`)
    return true
  } else {
    console.log(`\n❌ FAIL — ${issues.length}개 차이 발견:`)
    issues.forEach((i) => console.log('  ' + i))
    return false
  }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--all')) {
    // fixtures 폴더의 모든 golden 파일 검증
    const goldens = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.golden.json'))
    if (goldens.length === 0) {
      console.log('ℹ️  golden 파일 없음. 먼저 --update로 생성하세요.')
      return
    }
    let passed = 0, failed = 0
    for (const golden of goldens) {
      const srcName = golden.replace('.golden.json', '')
      const candidates = ['.pdf', '.png', '.jpg', '.jpeg']
      const srcFile = candidates.map((e) => path.join(FIXTURES_DIR, srcName + e)).find(fs.existsSync)
      if (!srcFile) {
        console.log(`⚠️  원본 파일 없음: ${srcName}`)
        continue
      }
      const ok = await runFile(srcFile, false)
      ok ? passed++ : failed++
    }
    console.log(`\n결과: ${passed} passed, ${failed} failed`)
    if (failed > 0) process.exit(1)
    return
  }

  const filePath = args.find((a) => !a.startsWith('--'))
  if (!filePath) {
    console.log('사용법: npx tsx scripts/test-parse.ts <파일경로> [--update]')
    process.exit(1)
  }

  const update = args.includes('--update')
  await runFile(filePath, update)
}

main().catch((e) => { console.error(e); process.exit(1) })
