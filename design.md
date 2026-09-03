# Design Specification: 학생·학부모 학습 리포트 (share 페이지)

> **원본 사양은 `학습 리포트 디자인 벤치마킹/design_handoff_share_report/README.md` 다.**
> 이 파일은 코드베이스 쪽 요약이다. 두 문서가 어긋나면 handoff README 를 따른다.

## 0. 참고 도메인 (왜 이렇게 생겼나)
- **이 화면은 금융 대시보드가 아니라 "주간 학습 리포트" 다.**
- 정보 구조: **이번 주 한 줄 → 할 일 → 기간 요약(리스트 + 그래프) → 코멘트.**
  데이터 스코프는 항상 **선택한 기간(class_period)** 이다.
- 폐기된 이전 사양: "Toss-style, Ethereal Analyst"(그라데이션 배경 `#EBF3FF→#FFF`,
  컬러 그림자, 지표별 색상, 델타 칩, 이모지 하이라이트) — 전부 쓰지 않는다.

## 1. 색 (Color budget)
색은 **의미가 있을 때만** 쓴다. 카테고리(시험/단어/과제)마다 색을 배정하지 않는다.
토큰 원본은 `src/app/share/[token]/share-tokens.ts` 의 `T`.

- 파랑 `#3182F6` (진한 `#1B64DA`, 연한 배경 `#E8F3FF`): 선택된 항목, 누를 수 있는 액션,
  긍정 변화(+%p, 반 평균 이상), 출석.
- 빨강 `#F04452` (진한 `#D22030`, 연한 배경 `#FFEEEE`): 주의 — 오답, 결석, 하락(-%p),
  반 평균 미만, 정답률 60% 미만, 과제 미제출, 고착/악화 패턴.
- 그 외 전부 그레이 스케일. `emerald` / `amber` / `indigo` / `violet` 카테고리 틴트 금지.
- 캔버스 `#FFFFFF` · 카드 `#F9FAFB` · 카드 안 박스 `#F2F4F6`(카드 안에서는 `#FFFFFF`)
- 구분선 `#EEF1F4`(카드 내부) / `#E5E8EB`(강한 구분)
- 텍스트: primary `#191F28` · secondary `#333D4B` `#4E5968` · muted `#6B7684` `#8B95A1`
  · placeholder/비활성 `#B0B8C1` `#D1D6DB`
- 다크 패널 `#191F28` — 단어 재시험 집중 모드에만.
- **다크 모드는 이번 사양 범위 밖이다.** 화면은 라이트 기준으로 그린다.

## 2. 타이포그래피
- `Pretendard Variable` 유지. `word-break: keep-all`, `-webkit-font-smoothing: antialiased`.
- 숫자는 `font-variant-numeric: tabular-nums`.
- 스케일: 헤드라인 23px/700/1.32/-0.025em · 섹션 타이틀 15px/800 · 큰 숫자 20px/700
  · 본문 13–15px/500 · 라벨 11–12px/600–700 · 캡션 10–11px `#8B95A1`.

## 3. 표면 (Surface)
- **그림자 없음.** 카드는 배경색 차이로만 구분한다 (`#FFFFFF` 캔버스 위 `#F9FAFB` 카드).
- 라운드: 카드 20px · 작은 카드/세그먼트 18px · 칩 999px · 내부 박스 12–14px
  · 바텀시트 20px 20px 0 0.
- 모바일 전용. 콘텐츠 최대폭 430px 중앙 정렬, 좌우 패딩 16px, 카드 간격 12px.
- 하단 고정 탭바(5탭) 약 64px + safe-area, 콘텐츠 하단 패딩 92px.

## 4. 화면 구조
- 헤더: 좌 학년·학교·반(12px `#8B95A1`) + 이름(20px/800), 우 기간 선택 pill → 바텀시트.
- 탭 5개: 홈 · 기록 · 분석 · 오답 · 단어.
- 홈: ① 이번 주 카드(헤드라인 + 팩트 리스트) ② 선생님 코멘트 ③ 할 일 ④ 기간 요약(행 + 라인 그래프).
- 자세한 탭별 사양은 handoff README 의 "화면 구성" 절.

## 5. 인터랙션 / 모션
종류는 적게, 일관되게. 모바일 전용이라 hover 상태는 정의하지 않는다.
- **press**: `active:scale-[.985]` (CTA·선택지 `.98`, 하단 탭 `.92`), 리스트 행은 배경 `#F2F4F6` 추가, 120ms.
- **rise**: 탭 진입 카드 스태거 — 450ms `cubic-bezier(.2,.8,.2,1)`, delay 0/60/120/180ms.
- **countUp**: 요약 숫자 0→값 700ms ease-out cubic. `visibilityState==='hidden'` 이면 스킵,
  800ms 폴백 타이머로 최종값 보장.
- **draw**: 그래프 선 `stroke-dashoffset 1→0` 800ms. 영역 채움은 반드시 `fill-opacity` 로 애니메이션.
- **sheetUp / pop / shake / tabIndicator / chevron** — handoff README 표 참조.
- 키프레임은 `src/app/globals.css` 의 `share-*` 에 모아 둔다.
- `prefers-reduced-motion: reduce` 에서는 최종 상태만 그린다.

## 6. 구현 메모
- Tailwind + lucide. 색 상수는 `share-tokens.ts` 의 `T` / `rateColor` / `deltaColor` 만 쓴다.
- 공용 표면은 `share-components.tsx` 의 `Card` / `SURFACE_CLASS` / `EmptyState` / `EmptyNote`,
  프리미티브는 `share-ui.tsx` 의 `Segmented` / `Chip` / `Chevron` / `CountUp` / `AccordionRow` 만 쓴다.
  탭 파일에서 표면 클래스를 직접 만들지 않는다.
