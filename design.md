# Design Specification: 학생·학부모 학습 리포트 (share 페이지)

## 0. 참고 도메인 (왜 이렇게 생겼나)
- **이 화면은 금융 대시보드가 아니라 "주간 학습 리포트" 다.** 참고 문법은 Whoop · Strava · Apple Fitness 의
  주간 리포트, ClassDojo · Seesaw 의 교사→학부모 소통 화면, 국내 에듀테크(산타·밀크티) 학부모 리포트.
- 학부모가 읽는 순서: **이번 주 어땠나 (한 문장) → 뭐가 문제였나 (오답) → 흐름은 어떤가 (추세).**
  홈 탭은 이 순서를 그대로 따른다. 숫자 나열(스탯 카드 격자)로 시작하지 않는다.
- 이전 사양("Toss-style, Ethereal Analyst")은 폐기. 그라데이션 배경·글로우 그림자·24px 라운드·
  지표별 색상·델타 칩·이모지 하이라이트가 "AI 가 만든 대시보드" 인상의 주범이었다.

## 1. 색 (Color budget)
색은 **의미가 있을 때만** 쓴다. 지표(시험/단어/과제)마다 다른 색을 배정하지 않는다.

### Light
- Page background: `#F5F6F8` (단색, 그라데이션 없음)
- Surface (card): `#FFFFFF`, 1px hairline `#E9EBEF`
- Ink (headline): `#1A1C1E`
- Body text: `#3F4650`
- Muted: `#8B95A1`
- Hairline / track: `#EEF0F3`

### Dark
- Page background: `#0B0F17`
- Surface: `#151B26`, 1px hairline `rgba(255,255,255,0.06)`
- Ink: `#F1F5F9` · Body: `#CBD5E1` · Muted: `#8B95A1` · Track: `rgba(255,255,255,0.08)`

### Accent (하나만)
- Accent: `#2463EB` (dark `#3B82F6`). 용도: 링크·행동 버튼·진행 막대·활성 탭·출석 표시.
- Negative (오답·결석에만): `#E5484D` (dark `#F87171`).
- 그 외 emerald/amber/violet 계열은 share 화면에서 쓰지 않는다. 예외: 오답노트 정오 표시(rose/emerald), 출결 캘린더 지각(amber).

## 2. 타이포그래피
- 폰트: 전역 설정(Pretendard → Geist 폴백)을 그대로 쓴다. 별도 웹폰트 로드 없음.
- 학생 이름 22px / bold. 리포트 헤드라인 17px / semibold / leading-snug.
- 섹션 제목 15px / bold. 본문 14px. 보조 12–13px muted. 숫자는 `tabular-nums`.
- **큰 숫자 금지.** 40–56px 히어로 숫자는 쓰지 않는다. 가장 큰 숫자도 17px 안에서 문장 속에 들어간다.

## 3. 표면 (Surface)
- 카드: radius **16px** (`rounded-2xl`), 1px hairline border, **그림자 없음.**
- 카드 안에 카드(색 타일) 중첩 금지. 카드 안은 hairline 구분선(`divide-y`)으로 나눈다.
- 페이지 여백 16px, 카드 간격 12px, 카드 내부 여백 20px.
- 배지/칩은 무채색. 색 칩·이모지 칩 금지.

## 4. 홈 탭 구조 (위→아래)
1. **학생 헤더** — 카드 없이 텍스트만. 학교·학년·반 (muted) / 이름 (22px).
2. **이번 주 리포트 카드** (홈의 유일한 히어로)
   - eyebrow: `이번 주 · {주차} · {날짜}`
   - 헤드라인 한 문장 (`buildWeeklyHeadline`) — 변화 > 만점 > 반 평균 대비 > 담담한 점수.
   - 선생님 코멘트가 있으면 헤드라인 바로 아래 인용 블록으로 (코멘트가 주인공).
   - 지표 행 3개 (시험·단어·과제): `라벨 | 진행 막대 | 점수 | 지난주 대비`. 막대는 accent 단색.
   - 하단 행동: `오답 N문항 다시 보기 ›` (accent 텍스트 버튼).
3. **최근 흐름** — 3열 텍스트(시험·단어·과제 평균)와 작은 스파크라인. 색 없음. 탭하면 성적 탭.
4. **출결** — 한 줄 요약(`정규 4/4회 · 클리닉 3/4회`) + 캘린더. 색 타일·필 토글 없음.
5. **선생님 코멘트 기록** — 이번 주 코멘트를 제외한 지난 코멘트. 날짜 + 본문 타임라인. 없으면 섹션 자체를 그리지 않는다.
- 홈에서 뺀 것: 4열 스탯 카드, "이번 주 잘한 것" 이모지 칩, 과제 제출률 차트(→ 성적 탭).

## 5. 인터랙션
- 눌리는 것은 `active:opacity-70` 만. `active:scale-*` 는 쓰지 않는다.
- 하단 탭바: 활성 탭 accent, 아이콘 확대 애니메이션 없음.
- 반·기간 선택은 카드가 아니라 헤더 아래 한 줄 텍스트 + 텍스트 버튼.

## 6. 구현 메모
- Tailwind + lucide. 모든 색은 `dark:` 변형을 함께 쓴다.
- 공용 표면은 `share-components.tsx` 의 `Card` / `SURFACE_CLASS` / `EmptyState` 만 쓴다. 탭 파일에서 표면 클래스를 직접 쓰지 않는다.
