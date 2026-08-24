# 2026-08-24 — React Compiler 스킵 원인 일괄 제거 (35 → 2) + 문자 예약 시각 버그 수정

앞선 작업([2026-08-23](2026-08-23-rerender-optimization.md))에서 `reactCompiler: true` 를 켰지만,
**컴파일러가 조용히 건너뛰던 컴포넌트가 35개** 였다. 그 원인을 전부 제거했다.

결과: 컴파일되는 함수 **228 → 261개**, 스킵 **35 → 2개**.
검증: `npm run check` 0 에러 / 경고 30(작업 전과 동일) / 348 테스트 통과.

> 스킵 여부는 린트에 안 뜬다. babel-plugin-react-compiler 의 `logger.logEvent` 로 `CompileError`
> 이벤트를 수집하는 임시 스크립트로 찾았다 (커밋에는 포함하지 않음).

## 1. 공통 헬퍼 — `src/lib/async-ui.ts`

컴파일러는 **컴포넌트 본문 안의** `try { } finally { }`, `try` 안의 `throw`/`?.`/`??` 를 아직
다루지 못해 그 컴포넌트를 통째로 최적화에서 뺀다. 이 프로젝트에서 가장 흔한 패턴이
`setLoading(true) … finally setLoading(false)` 라서, `try` 를 모듈 함수로 몰았다.

- `runWithLoading(setLoading, fn, onError)` → 성공 true / 실패 시 onError 호출 후 false. 로딩은 항상 해제.
- `runOrReport(fn, onError)` → 로딩 플래그 없는 버전.
- `errorMessage(error, fallback)` → `Error.message` 또는 fallback.
- 테스트: [tests/unit/async-ui.test.ts](../../tests/unit/async-ui.test.ts) — 성공/실패/로딩 해제 시점/에러 원본 전달.

**부작용 가능 지점**
- `onError` 는 `(error: unknown) => void`. 기존 `catch { }` 블록이 하던 일을 그대로 옮겼을 뿐이지만,
  **`return` 으로 함수를 빠져나가던 catch 는 의미가 달라진다.** 호출부에서 `if (!ok) return` 으로
  받아야 한다 (단어 세팅의 랜덤 출제·클리닉 인쇄가 그 케이스).
- `finally` 에 로딩 해제 말고 다른 정리(타이머 clear, 진행 문구 비우기)가 있던 곳은
  `(loading) => { setX(loading); if (!loading) { …정리… } }` 형태의 결합 setter 로 넘겼다.
  → 정리 코드가 **시작 시점에도 불리지 않도록** `if (loading) return` 가드가 붙어 있다. 여기 실수하면
  업로드 시작하자마자 타이머가 꺼진다.

## 2. 문자 예약 발송 시각 버그 (실제 결함)

`sms-sheet` · `clinic-sms-sheet` · `broadcast-dialog` 세 곳이 똑같이 이랬다:

```ts
const isSchedulePast = useMemo(() => {
  …
  return new Date(`${date}T${time}:00+09:00`).getTime() <= Date.now()   // ← 렌더 중 Date.now()
}, [scheduleEnabled, scheduleDate, scheduleTime])
```

의존성에 시간이 없으니 **한 번 계산된 값이 굳는다.** 예약 시간을 1분 뒤로 잡고 2분을 기다린 뒤
발송하면 `isSchedulePast` 는 여전히 `false` → 가드를 통과해 **과거 시각으로 예약 요청이 나갔다.**

- [src/lib/sms-schedule.ts](../../src/lib/sms-schedule.ts) — `scheduledAtMs`, `isSchedulePast(date, time, now)`.
  기준 시각을 인자로 받아 순수 함수로 유지.
- [src/hooks/use-now-tick.ts](../../src/hooks/use-now-tick.ts) — `useSyncExternalStore` 로 시계를 구독.
  10초 단위로 굳힌 스냅샷이라 불필요한 리렌더가 없고, SSR 스냅샷은 0.
- 화면 표시(경고 문구·버튼 disabled)는 `useNowTick()` 값 → **최대 10초 뒤처진다.**
- 발송 핸들러는 `Date.now()` 로 **다시 판정**한다 → 확정 가드. 2단 구조가 의도다.

**부작용 가능 지점** — 버튼이 잠깐(≤10초) 활성으로 보일 수 있지만, 누르면 핸들러가 막고 toast 를 띄운다.
`useNowTick` 은 마운트된 동안 10초마다 리렌더를 유발하므로, 무거운 컴포넌트에 무심코 쓰면 손해다.

## 3. 나머지 스킵 원인별 처리

| 사유 | 개수 | 처리 |
|---|---|---|
| `try/finally`, try 안 `throw`/`?.`/`??` | 24 | `runWithLoading`/`runOrReport`, 일부 `useMutation` |
| `catch` 없는 `try` | 3 | `runWithLoading` + **에러 toast 신설** |
| 호이스팅된 함수 참조 | 2 | 선언 순서 교체 |
| `eslint-disable … exhaustive-deps` 주석 | 3 | 억제 없이 재작성 |
| 동적 `import()` | 1 | pdfjs 렌더링을 모듈 함수로 추출 |
| 람다가 붙잡은 `i++` | 1 | `for (const [index, it] of items.entries())` |
| `??` 를 품은 값이 `\|\|` 의 좌변 | 1 | 정렬 비교자를 중간 변수로 |

### 짚어둘 것

**(a) `eslint-disable … exhaustive-deps` 주석 자체가 스킵 사유다.**
컴파일러 메시지는 "rules were **disabled**" — 위반이 아니라 *억제*를 보고 포기한다.
`react-hooks/set-state-in-effect` 억제는 스킵을 유발하지 않는 것으로 확인했다(그래서 SSR 때문에
어쩔 수 없는 곳은 그 규칙만 껐다). **앞으로 `exhaustive-deps` 를 끄면 그 컴포넌트는 최적화에서 빠진다.**

**(b) 한 줄이 1,000줄짜리 컴포넌트를 통째로 뺐다.**
`ClassDetailPage` 의
`(a.start_date ?? '').localeCompare(b.start_date ?? '') || a.week_number - b.week_number`
— `??` 를 품은 값을 `||` 의 좌변에 두면 컴파일러 내부에서 터진다. 이등분 탐색으로 찾았다.
같은 패턴이 다른 파일에도 있으면 같은 일이 벌어진다.

**(c) 컴파일이 되기 시작하면 새 린트 에러가 드러난다.** 이번에 8건 나왔고, 대부분
`react-hooks/set-state-in-effect` 였다. AGENTS.md 의 **렌더 중 조정** 패턴으로 풀었다:

```ts
const [synced, setSynced] = useState(key)
if (synced !== key) { setSynced(key); setDerived(...) }
```

적용한 곳 8군데: 학원 설정 폼 / 성적표 상세 편집 / 출결 맵·스케줄 스냅 / 해설 편집 맵 /
단어 정오표·사진 URL / 문자 프롬프트 / 성적표 발송 선택 정리 / 문제 검색 선택 초기화.
→ **서버 데이터 도착 시 편집 state 가 한 프레임 빨리 반영된다.** 기존엔 빈 폼이 한 번 그려졌다.

SSR 때문에 effect 가 맞는 2곳(학생 목록 localStorage 복원, 성적표 발송 URL 쿼리 복원)은
사유 주석과 함께 `set-state-in-effect` 만 껐다.

## 4. 동작이 바뀐 곳 (검토 필요)

1. **로그인 / 회원가입 / 문자 학생목록 로딩** — 기존엔 `catch` 가 없어 네트워크 오류가
   unhandled rejection 으로 조용히 사라졌다. 이제 toast 로 알린다.
2. **출결 저장 실패** — `saveAttendance` 훅의 `onError` 가 이미 toast 를 띄우므로 중복 방지로
   `runOrReport` 의 onError 는 기존 메시지를 유지했다. 클리닉 등록/해제는 훅이 toast 를 띄우므로
   onError 는 빈 함수 — **의도적이다.**
3. **exam-bank 문제 검색 URL 동기화** — `useSearchParams()` 값 대신 effect 안에서
   `window.location.search` 를 직접 읽는다. 외부에서 URL 이 바뀌어도 이 effect 는 다시 돌지 않는다
   (기존 억제 주석의 의도와 동일).
4. **일괄 해설 업로드** — 루프가 `for(let i…)` → `entries()` 로 바뀌었다. 순서·동작 동일.

## 5. 수동 확인 포인트

- **문자 발송 3화면**: 예약 켜고 과거 시각 → 경고/비활성. 1분 뒤로 잡고 2분 기다린 뒤 발송 → **막혀야 한다**(예전엔 통과).
- 단어 세팅: 단어장 로딩, 체크/칩/개수/검색, 랜덤 출제, 시험지 저장, 엑셀 다시 올리기
- 시험지 가져오기(answer-sheet-uploader): 문항 → 정오표 → 해설 3단계 + 경고 다이얼로그 "계속"
- 출결: 날짜 이동, 스케줄 밖 날짜 스냅, 저장
- 성적표 발송: 대상 불러오기 → 수신자 바꿔 선택 자동 정리 → 생성 → 전송
- 학생 목록: 필터/정렬 후 새로고침 시 복원
- 기출문제 은행: 문제 검색 필터 → 검색 → URL 반영(`?points=2` 확인 완료) → 뒤로가기

## 6. 남긴 2개 (고칠 이유 없음)

- `AnswerSheetPrintPage` — async **서버 컴포넌트**. 리렌더가 없어 최적화 대상이 아니다.
- `StudentFormDialog` — `react-hook-form` 의 `watch()` 비호환. 라이브러리를 바꾸지 않는 한 불가.
