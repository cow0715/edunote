# 백업 개선 TODO

현재 Supabase Entry 플랜 사용 중 (자체 백업 기능 없음).
매일 새벽 3시 cron → Supabase Storage JSON 덤프로 운영 중.

---

## 우선순위 순

### 1. Cloudflare R2 이중화 연결 (높음)
지금은 Supabase Storage에만 저장 → Supabase 계정 문제 시 백업도 소실 위험.
R2는 S3 호환 API라 코드 변경 없이 환경변수만 추가하면 됨.

Vercel에 추가할 환경변수:
```
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
BACKUP_S3_REGION=auto
BACKUP_S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
BACKUP_S3_BUCKET=edunote-backup
```

참고: `src/lib/s3-backup.ts` 이미 구현 완료. 환경변수만 채우면 동작.

---

### 2. 백업 실패 알림 (높음)
지금은 실패해도 조용히 넘어감. `backup_log`에 `status = 'error'` 찍히면 알림 필요.

구현 방법 (택1):
- **이메일**: Resend 또는 Nodemailer로 cron 실패 시 발송
- **슬랙 웹훅**: Slack Incoming Webhook URL로 POST

위치: `src/app/api/cron/backup/route.ts` — 실패 분기에 알림 추가.

---

### 3. 오래된 백업 자동 삭제 (낮음)
Supabase Storage 용량 제한 있음. 30일 이상 된 파일 자동 삭제 cron 추가.

구현 위치: 새 cron 라우트 `src/app/api/cron/cleanup/route.ts`
스케줄: `vercel.json`에 월 1회 정도 추가.

---

### 4. 복구 테스트 주기적으로 (낮음)
`/api/backup/restore` 구현 완료되면 개발 DB에서 실제 복구 테스트 해볼 것.
백업 파일이 있어도 복구가 안 되면 의미 없음.
