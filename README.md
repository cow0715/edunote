# EduNote

영어 학원 강사를 위한 **학생 관리 · 채점 자동화 · 학부모 리포트** 웹 서비스입니다.
매주 치르는 진단평가(독해)·단어 시험의 시험지 PDF와 답안지 사진을 올리면 AI(OCR + LLM)가
문항을 구조화하고 채점하며, 결과를 학생/학부모에게 공유 링크·성적표·문자로 전달합니다.

> 실제 학원 운영에 사용 중인 프로젝트입니다. 개발 DB 와 운영 DB 를 분리해 운영합니다.

## 주요 기능

| 영역 | 내용 |
|---|---|
| 수업 · 주차 관리 | 반(class)별 주차(week) 단위로 진단평가·단어 시험·숙제와 학생별 답안/점수를 관리 |
| 시험지 PDF 구조화 | 진단평가 해설지/문제지 PDF → LLM 파싱 → 문항(지문·발문·선지·정답·유형·개념 태그) 자동 생성, 도표 문항은 원본 이미지 크롭 보존 → [아래 상세](#시험지-pdf--구조화-문항-파이프라인) |
| AI 채점 | 답안지 사진 업로드 → Clova OCR / Claude Vision 인식 → 객관식·단어·빈칸 자동 채점 + 서술형 LLM 채점, 강사 검수 후 확정 |
| 단어 시험 | 단어장(xlsx) 업로드, 유형별(뜻·철자·선택형·예문 빈칸) 비율로 시험지 자동 출제·인쇄, 오답 규칙 기반 채점 |
| 기출문제 은행 | 수능·모평·학평 기출 PDF 파싱 → 25종 유형 분류 → 메가스터디 정답률·난이도 연동 → 전문 검색(tsvector), 해설 PDF 파싱·AI 보완 |
| 모의고사 | 문제지·정답표·해설지 다중 PDF에서 메타데이터(정답·배점·유형·난이도·복수정답) 추출, OMR 일괄 인식·학생 자동 매칭, 등급 산출, 리포트 발송 |
| 학생 현황 분석 | 강사 화면: 주차별 점수 추이·반 평균 비교 / 학부모 공유 페이지: 유형별 취약점 레이더·오답 유형 파이, 불안정 패턴 감지 |
| 학부모 공유 | 학생별 공유 토큰 링크(로그인 불필요), 성적표 공개 뷰, 모의고사 리포트, 재시험(retake) 페이지 |
| 메시지 발송 | Solapi SMS — 주차 결과·성적표·모의고사 리포트 일괄 발송, LLM 으로 문구 다듬기 |
| 클리닉 | 보충 수업 슬롯·등록·출석 관리 및 안내 문자 |
| 운영 | 가입 승인제, Vercel Cron 으로 보관 기간 지난 Storage 객체(단어 시험지 사진) 매일 정리 |
| DB 백업 · 복원 | **구현 예정** — 앱 레벨 JSON 덤프 대신 DB 단 표준 방식(Supabase PITR / `pg_dump` 를 GitHub Actions 스케줄로 외부 저장소에 적재)으로 설계 중 |

## 시험지 PDF → 구조화 문항 파이프라인

이 프로젝트에서 가장 공을 들인 부분입니다. 학원 자체 **진단평가**(주차별 독해 시험) PDF를
채점 가능한 문항 데이터로 바꾸는 흐름:

```
PDF 업로드 (Supabase Storage signed URL — Vercel 4.5MB body 한도 우회)
  └─ 3페이지 청크 분할 · 동시 2개 처리 · 청크 실패 시 1페이지 단위 재시도   (week-reading-import.ts)
       └─ Claude document 블록으로 LLM 파싱                                 (anthropic.ts, prompts.ts)
            ├─ 해설지형: 문항+정답 한 번에          parseAnswerSheet
            ├─ 문제지형: 문항만 → 정오표 별도 업로드  parseWeekProblemSheetPage / 정답 수 ≠ 문항 수면 적용 거부
            └─ 강사의 개념 태그 목록을 프롬프트에 주입 → 목록 중에서만 유형 선택
                 └─ 구조화 · 후처리
                      ├─ question_stem / passage / choices 3분할 저장 + 레거시 단일 텍스트 동시 생성 (question-structure.ts)
                      ├─ 번호 누락/중복 재배정, 소문항 라벨 정규화, 요약문 (A)(B) 오분할 복구
                      ├─ bold · 밑줄 마크업 보존, "밑줄 친 낱말" 문항은 지문에 ① <u>…</u> 자동 부착
                      └─ 도표/표 문항: LLM 이 반환한 bbox 로 pdfjs 렌더 → sharp 크롭 → 원본 이미지 저장
                           └─ exam_question upsert → 태그 연결 → 기존 학생 답안 자동 재채점 (객관식 코드 / 서술형 LLM)
```

같은 기반 위에 목적이 다른 파이프라인 두 개가 더 있습니다.

| 파이프라인 | 입력 | 산출 | 특징 |
|---|---|---|---|
| **기출문제 은행** (`/api/exam-bank`) | 수능·모평·학평 PDF | `exam_bank_question` | 18~45번 추출, 유형 25종 enum 강제, 콘텐츠 필터 시 페이지 PNG 렌더로 재시도, **메가스터디 통계 스크래핑**(EUC-KR 디코딩, 시험 월 변동 대응)으로 정답·배점·난이도·선지별 선택률 채움, 해설 PDF 는 정규식/Vision 3경로 파싱 |
| **모의고사** (`/api/mock-exams/[id]/metadata`) | 문제지+정답표+해설지 다중 파일 | `mock_exam_question` | 본문 없이 메타데이터만(토큰 절약), 정답표 집중 2차 패스로 정답 신뢰도 보정, OMR 인식은 응답률 75% 미만 시 strict 재인식 + 성명 칸 별도 재시도, Levenshtein 기반 재원생 자동 매칭(임계 미달 시 `review_required`) |

**신뢰성 장치**
- LLM JSON 응답 복구 2단: `jsonrepair` → 실패 시 지문 속 미이스케이프 따옴표 보정(`json-lenient.ts`) → 그래도 실패하면 문항 객체 단위 정규식 추출
- 서술형 채점은 배치 분할 + `Promise.allSettled`, 실패 배치는 `needs_review` 로 강등해 강사가 확인
- 암호화(owner-lock) PDF 대응, 긴 PDF 청크/페이지 단위 재시도, 외부 통계 실패는 파싱 결과에 영향 없음
- 파싱 회귀 하네스(`scripts/test-parse.ts`, golden JSON 비교) · 모델 비교 도구(`/dev` — haiku/sonnet/opus 교차 실행, 호출당 비용 집계, direct-pdf vs 텍스트 추출 vs 하이브리드 3모드 비교)

## 기술 스택

- **Framework**: Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- **UI**: Tailwind CSS v4 · shadcn/ui (Radix) · lucide-react · Recharts / ECharts / Nivo · TipTap
- **State / Data**: TanStack Query · Zustand · react-hook-form + zod
- **Backend**: Next.js Route Handlers · Supabase (PostgreSQL, Auth, Storage, RLS)
- **AI / 외부 API**: Anthropic Claude (파싱·채점·해설 생성) · Naver Clova OCR · Solapi (SMS)
- **PDF / 이미지**: unpdf · pdfjs-dist · pdf-lib · sharp · @napi-rs/canvas
- **Infra**: Vercel (Cron 포함)
- **Test / Lint**: Vitest · Testing Library · ESLint

## 프로젝트 구조

```
src/
├─ app/
│  ├─ (auth)/            로그인 · 회원가입
│  ├─ (admin)/           강사용 관리 화면 (대시보드, 학생, 모의고사, 기출은행, 분석, 설정 …)
│  ├─ share/[token]/     학부모·학생 공유 페이지 (공개)
│  ├─ report-cards/      성적표 공개 뷰
│  ├─ mock-exam-reports/ 모의고사 리포트 공개 뷰
│  └─ api/               Route Handlers (파싱, 채점, OCR, 발송, cron …)
├─ components/           UI 컴포넌트 (shadcn 기반 + 도메인 컴포넌트)
├─ lib/                  순수 로직 (PDF 파싱·문항 구조화, 채점 규칙, 단어 출제, 성적표 계산, 프롬프트 …)
└─ proxy.ts              인증 미들웨어 (Next.js 16 의 middleware)
supabase/migrations/     DB 스키마 마이그레이션 SQL
tests/unit/              lib 순수 로직 유닛 테스트 (vitest)
tests/api/               API 통합 테스트 (개발 서버 + 개발 DB 필요)
scripts/                 파싱 회귀 테스트, 채점 모델 비교 등 운영 스크립트
docs/                    설계 문서 · 작업 로그
```

## 시작하기

```bash
npm install
cp .env.example .env.local   # 값 채우기 (아래 환경변수 참고)
npm run dev                  # http://localhost:3000
```

DB 스키마는 `supabase/migrations/` 의 SQL 을 Supabase SQL Editor 에 순서대로 적용합니다
(초기 스키마: `20260323160235_remote_schema.sql`).

### 환경변수

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 (cron 정리·관리 작업) |
| `NEXT_PUBLIC_APP_URL` | 공유 링크 생성용 베이스 URL |
| `ANTHROPIC_API_KEY` | Claude 파싱·채점·해설 생성 |
| `CLOVA_OCR_API_URL`, `CLOVA_OCR_SECRET` | Naver Clova OCR |
| `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER` | SMS 발송 |
| `CRON_SECRET` | Vercel Cron → `/api/cron/cleanup` 인증 |
| `NEXT_PUBLIC_DB_ENV` | (선택) `dev` / `prod` — 개발자 도구 페이지의 DB 표시용 |

전체 목록은 [`.env.example`](.env.example) 참고.

## 개발 워크플로

```bash
npm run check        # tsc --noEmit + eslint + vitest  (커밋 전 필수, 초록불 기준)
npm run test         # 유닛 테스트만
npm run test:api     # API 통합 테스트 (dev 서버 :3000 + 개발 DB 필요)
npm run test:parse   # ⚠ 실제 LLM 호출 (과금) — 해설지 파싱 회귀 테스트 (golden JSON 비교)
```

- `src/lib/` 의 순수 로직을 수정하면 `tests/unit/` 에 테스트를 함께 추가합니다.
- 스키마 변경은 반드시 `supabase/migrations/` 에 SQL 파일을 같이 남깁니다.
- 협업 규칙(검증·디자인 시스템·마이그레이션)은 [AGENTS.md](AGENTS.md), 디자인 사양은 [design.md](design.md) 에 정리되어 있습니다.

## 문서

- [docs/weakness-analysis-design.md](docs/weakness-analysis-design.md) — 취약점 분석 설계 (불안정 패턴·최근 가중 정답률, 반영 완료)
- [docs/worklog/](docs/worklog/) — 작업 로그
