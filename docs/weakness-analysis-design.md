# 약점 분석 설계 문서

작성일: 2026-03-31

---

## 배경 및 전제

### 데이터 특성 (희소 데이터)

영어 학원 환경에서 실제 누적되는 데이터량:

| 항목 | 규모 |
|------|------|
| 주당 reading 문항 수 | 10~20개 |
| 태그당 주당 문항 수 | 1~3개 (보통 1개) |
| 학생당 축적 주차 | 4~10주 |
| 한 태그의 총 문항 수 | **2~8개** |

→ 문항 1개의 정오(O/X)가 전체 판단을 좌우할 수 있는 규모.

---

## 현행 로직의 문제점

### 1. `firstAccuracy` / `latestAccuracy` 단일 주차 비교 (가장 큰 문제)

```
"주제 찾기" 태그:
  1주: 문항 1개, 틀림 → accuracy 0%
  3주: 문항 2개, 2개 맞음 → accuracy 100%
  5주: 문항 1개, 맞음 → accuracy 100%

현재: diff = 100% - 0% = +100% → "개선"
실제: 1주차 문항 1개를 틀렸을 뿐
```

단일 주차 accuracy는 문항 수가 적을수록 의미 없음.

### 2. `stdDev < 25` 고착 판정 — 문항 수 무시

주차당 accuracy가 `[0, 0, 50, 0]`이면 stdDev ≈ 21.7 → "고착".
문항 1개짜리 주차와 5개짜리 주차가 동등한 가중치.

### 3. `diff <= -15` 악화 기준 — 너무 쉽게 달성

주당 1~3문항이면 accuracy는 0%, 33%, 50%, 67%, 100% 같은 이산값.
1문항 차이 = 33~100%p 차이. 15%p 기준은 1문항만 더 틀려도 넘어감.

---

## 개선 설계

### 핵심 원칙

> **"문항 수가 적을수록 판단을 보수적으로, 많을수록 확신을 높인다"**

### 통계 계산 체계

| 항목 | 현재 (문제) | 개선 (채택) |
|------|------------|------------|
| overallAccuracy | `totalCorrect / totalTotal` | 동일 (이미 가중) ✓ |
| trend | `lastWeek% - firstWeek%` | **앞/뒤 절반 가중 평균** 차이 |
| recentAccuracy | `lastWeek%` (1주 단독) | **최근 2주 합산** 가중 평균 |
| volatility | `stdDev` (분산 기반) | `max(주차%) - min(주차%)` |
| 최소 기준 | 2주, 문항 수 무관 | 2주 + **총 문항 ≥ 4** |

#### trend 계산 방식

```ts
// 앞 절반 vs 뒤 절반 (주차 분할 기준)
const mid = Math.ceil(weekCount / 2)
const front = weeks.slice(0, mid)
const back  = weeks.slice(mid)

const frontAcc = sum(front.correct) / sum(front.total)  // 가중 평균
const backAcc  = sum(back.correct)  / sum(back.total)   // 가중 평균
const trend    = backAcc - frontAcc
```

단일 주차가 아닌 절반 구간의 누적 문항을 기준으로 계산.

#### recentAccuracy 계산 방식

```ts
const recentWeeks = weeks.slice(-2)  // 최근 2주
const recentAccuracy = sum(recentWeeks.correct) / sum(recentWeeks.total)
```

---

## 상태 분류 로직 (우선순위 순)

### 1. persistent (고착) — rose #f43f5e

```
조건: wrongWeekRatio >= 0.7 AND overallAccuracy < 0.5
```

- 출제 주차의 70% 이상에서 절반 이상 틀림
- 전체 누적 정답률도 50% 미만
- volatility 조건 제거: overallAccuracy + wrongWeekRatio 조합이면 충분

**인사이트**: `"N회 출제 중 M회 오답 · 평균 X%"`

### 2. deteriorating (악화) — orange #f97316

```
조건: trend <= -0.15 AND recentAccuracy < 0.5
```

- 뒤 절반 성적이 앞 절반보다 15%p 이상 낮음
- 최근 2주 합산 정답률도 50% 미만
- (기존 0.6 → 0.5로 하향: 문항 수 적은 환경에서 0.6은 2/3 이상이라 너무 빡빡)

**인사이트**: `"최근 정답률 X% · Y%p 하락 추세"`

### 3. improving (개선) — emerald #10b981

```
조건: trend >= 0.15 AND overallAccuracy < 0.7
```

- 뒤 절반 성적이 앞 절반보다 15%p 이상 높음
- 아직 전체 정답률이 70% 미만 (약점 범위 내)

**인사이트**: `"Y%p 상승 중 · 현재 X%"`

### 4. unstable (기복) — purple #a855f7 ← 신규 추가

```
조건: |trend| < 0.15 AND volatility >= 0.5
```

- 주차별 accuracy의 범위가 50%p 이상 (예: 0%~100% 또는 33%~100%)
- 뚜렷한 방향성 없음
- "맞을 때도 있고 틀릴 때도 있는" 패턴

**인사이트**: `"정답률 X%~Y% 변동 · 평균 Z%"`

### 미표시 케이스

위 4가지 어디에도 해당 안 되면 표시하지 않음. 데이터 부족이거나 실질적 약점이 아닌 경우.

---

## 원인 분석 (cause) — 미구현 결정

### 이유

현재 데이터에서 알 수 있는 것은 `is_correct` (맞음/틀림) **뿐**.

| 원인 라벨 | 판별에 필요한 데이터 | 현재 보유 |
|----------|---------------------|---------|
| 개념 부족 | 정답률 + 개념 이해도 측정 | 정답률만 있음 |
| 실수형 | 풀이 시간, 수정 횟수, 자기 확신도 | ✗ |
| 난이도 민감 | 문항별 난이도 메타데이터 | ✗ |
| 찍기형 | 답안 분포, 응답 시간 | ✗ |

문항당 1~3개의 binary 데이터로 원인을 구분하는 것은 통계적으로 불가능.
부정확한 라벨은 학부모/학생 오해를 유발. → **상태 분류 + 인사이트 문구**로 충분히 대체 가능.

---

## 인사이트 문구 설계

```ts
persistent:    `${weekCount}회 출제 중 ${wrongWeekCount}회 오답 · 평균 ${overallPct}%`
deteriorating: `최근 정답률 ${recentPct}% · ${Math.abs(trendPct)}%p 하락 추세`
improving:     `${trendPct}%p 상승 중 · 현재 ${recentPct}%`
unstable:      `정답률 ${minPct}%~${maxPct}% 변동 · 평균 ${overallPct}%`
```

---

## DB 캐싱 — 미도입 결정

### 근거

| 항목 | 수치 |
|------|------|
| 학생당 student_answer 건수 | ~100~200건 |
| classifyPatterns 실행 시간 | < 1ms |
| 메모리 사용량 | 무시 가능 |

DB `analysis_result` 테이블을 만들 경우:
- 채점 시마다 upsert 트리거 필요
- 캐시 무효화 로직 필요
- 동기화 버그 가능성 증가

→ **이 규모에서는 매번 계산이 더 단순하고 정확.**
DB 캐싱 검토 시점: 학생 수 1,000명 이상, 전체 학생 배치 분석 필요 시.

---

## 구현 범위 (최소 변경)

| 파일 | 변경 내용 |
|------|----------|
| `src/hooks/weakness/useAnalysis.ts` | `classifyPatterns` 내부 로직 교체 |
| `src/app/share/[token]/share-pattern.tsx` | `PATTERN_META`에 `unstable` 항목 추가 |
| `src/app/share/[token]/share-client.tsx` | `infoNode` 설명에 기복 항목 추가 |

API 신규 생성, DB 테이블 추가, 프론트 데이터 흐름 변경 **없음**.

---

## 정렬 순서

```
고착(0) > 악화(1) > 기복(2) > 개선(3)
같은 유형 내에서는 overallAccuracy 낮은 순
```

기복을 개선보다 앞에 배치: 방향성이 없는 불안정 상태가 개선보다 더 주의가 필요함.
