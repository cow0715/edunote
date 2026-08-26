# 2026-08-26 — exam-bank 페이지 분할

## 무엇이 왜

`src/app/(admin)/exam-bank/page.tsx`(2,971줄, 프로젝트 최대 UI 파일)를
`src/components/exam-bank/` 폴더의 10개 파일로 분할했다. 로직 변경 없는
move-only 리팩터링. page.tsx 는 탭 3개 + 다이얼로그 2개를 조립하는 59줄 셸만 남았다.

```
page.tsx (셸)
 ├─ exam-list.tsx ──────── question-list.tsx (QuestionList + QuestionCard)
 │   └─ explanation-upload-dialog.tsx     └─ question-edit-dialog.tsx
 ├─ question-search.tsx ── question-list.tsx (QuestionCard 재사용)
 ├─ vocab-collections.tsx
 ├─ upload-dialog.tsx
 └─ bulk-explanation-dialog.tsx
      (공용: types.ts / constants.ts / markdown.tsx)
```

## 이동 외 정리 (동작 변화 없음이 의도)

- **죽은 코드 삭제**: 정의만 되고 안 쓰이던 `hasRelatedWords`,
  QuestionCard 의 `copyQuestionWithTranslation` 계열,
  QuestionSearch 의 `copyAllWithTranslation`/`buildAllQWithTrans*` 삭제.
- **미사용 import 제거**: `Card`, `Textarea` 등.
- **미사용 eslint-disable 주석 제거** (markdown.tsx Tiptap onUpdate).
- `readApiError` 는 메시지가 단어장 전용이라 constants 가 아닌
  vocab-collections.tsx 로컬로 옮김.
- CSV BOM 이 `﻿` 이스케이프 → 리터럴 BOM 문자로 바뀜 (컴파일 결과 동일).

## 부작용 가능 지점

- 다른 곳에서 page.tsx 를 import 하는 코드는 없음을 확인했다 (자기완결 페이지).
- `QUESTION_TYPE_LABELS` 등이 constants.ts 로 공용화됨 — 이후 다른 페이지가
  가져다 쓰기 시작하면 exam-bank 전용 수정 시 영향 범위가 넓어진다.
- git blame 이 이동 커밋에서 끊긴다 — 과거 이력은 `git log --follow` 로 추적.
- 이 파일을 건드리는 다른 브랜치가 있다면 머지 충돌 확정.

## 수동 확인 포인트

- /exam-bank 세 탭(시험 목록·문제 검색·단어장) 렌더 확인
- 문제 검색: 필터 → URL 쿼리 동기화, 무한스크롤, 선택/전체 복사
- 시험 목록: 펼침 → 문항 카드, 해설 수정/복사, 문항 추가·수정 다이얼로그(Tiptap)
- PDF 업로드 / 해설 업로드(미리보기) / 일괄 해설 다이얼로그 열림·진행 표시

## 검증

`npm run check` 통과 (typecheck + lint + 유닛테스트 369개). 새 파일 lint 경고 0.
