# EduNote — Claude 협업 규칙

공통 규칙(검증, 디자인, 커밋/푸시, DB)은 AGENTS.md 가 원본이다. 규칙 수정도 그쪽에 한다.

@AGENTS.md

## Claude Code 전용: 자동 검증 훅
- `.ts/.tsx` 를 고치면 `.claude/hooks/check.sh` 훅이 백그라운드로 `npm run check` 를 돌린다.
  - 실패하면 자동으로 알림이 온다. 알림이 오면 **하던 일을 멈추고 먼저 고친다.**
  - 훅은 알림용 보조 장치일 뿐이다. 작업을 마치기 전에는 직접 `npm run check` 를 돌려 확인한다.

## Claude Code 전용: 마무리 워크플로
- 작업이 한 단위 끝나면 `/ship` 을 제안한다 — 변경 보고서 + 이해도 퀴즈 + 커밋 제안.
  커밋은 여전히 사용자 승인 후에만 한다.
