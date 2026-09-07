# 2026-09-07 — 사진 영구 보관 전환 · DB 백업 워크플로

## 1. 시험지/답안지 사진 30일 삭제 정리 제거

**무엇이 왜**
`vocab-photos`(단어 시험지)와 `exam-photos`(진단평가 답안지)를 30일 뒤 지우던 cron 을
통째로 걷어내고 영구 보관으로 바꿨다. 원본 사진은 OCR 오독을 나중에 다시 확인할 일이
계속 생기는데, 30일이면 이미 사라져 있었다. 운영 Storage 사용량을 확인해보니 4개 버킷
합쳐 약 118MB(무료 1GB의 12%)라 용량 압박이 없는 것도 결정 근거.

- `src/app/api/cron/cleanup/route.ts` — 삭제. 하는 일이 이 정리뿐이라 라우트째 제거했다.
- `src/lib/vocab-photo-retention.ts` → `src/lib/photo-buckets.ts` — 버킷 상수 2개만 남김.
- `tests/unit/vocab-photo-retention.test.ts` — 삭제.
- `vercel.json` — cleanup cron 등록 제거. `rotate-share-tokens` cron 은 그대로.
- `.env.example` / `README.md` — `VOCAB_PHOTO_RETENTION_DAYS` 제거, `CRON_SECRET` 설명을
  남아있는 cron(rotate-share-tokens) 기준으로 수정.

**부작용 가능 지점**
- `CRON_SECRET` 은 **계속 필요하다.** `rotate-share-tokens` 가 같은 값을 쓴다. 지우면 안 됨.
- `EXAM_PHOTO_BUCKET` import 경로가 바뀌었다 (`weeks/[id]/ocr-exam-photo/route.ts`).
- Vercel 환경변수에 남은 `VOCAB_PHOTO_RETENTION_DAYS` 는 이제 아무도 안 읽는다 (지워도 무해).
- 앞으로 사진이 무한 누적된다. 업로드 시 압축(1/15)은 그대로 살아있으므로 증가 속도는 완만.

**수동 확인**
- 배포 후 Vercel 대시보드 Cron 탭에 `/api/cron/cleanup` 이 사라졌는지.
- 정오표에서 "원본 사진" 버튼이 예전 회차에서도 계속 뜨는지 (앞으로 404 로 사라지지 않음).

## 2. GitHub Actions DB 백업 (.github/workflows/db-backup.yml)

**무엇이 왜**
매일 KST 03:00 에 운영 Supabase 를 `supabase db dump` 로 roles/schema/data 3종 + auth 유저
메타데이터로 받아 tar.gz 로 묶고, AWS OIDC 로 인증해 S3(STANDARD_IA, SSE-AES256)에 올린다.
앱 레벨 백업 대신 DB 단 표준 백업으로 옮기기로 한 방침의 구현.

**부작용 가능 지점**
- 필요한 GitHub Secrets: `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AWS_ROLE_ARN`, `AWS_REGION`, `S3_BUCKET`. 하나라도 없으면 매일 실패 알림이 온다.
- auth 유저는 **비밀번호 해시를 뜨지 않는다.** 이 백업만으로는 로그인 복구가 안 된다.
- 덤프가 10KB 이하면 실패 처리한다 (빈 덤프를 정상으로 오해하지 않기 위한 가드).
- 서비스 롤 키가 Actions 러너를 지나간다.

## 3. .gitignore — design-data/

Claude Design 프로토타입용 실데이터(학생 실명 포함)를 커밋하지 않도록 무시 목록에 추가.
