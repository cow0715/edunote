# 운영 오류 카카오톡 알림 설정

EduNote의 주요 서버 실패를 Sentry로 수집하고, 담당 개발자 한 명의 카카오톡 **나와의 채팅**으로 보낸다. 로컬과 Preview에서는 오류 수집, 웹훅 발송, 토큰 갱신 모두 비활성화된다.

## 수집하는 실패

| API | 알림 범위 |
| --- | --- |
| `POST/PATCH /api/weeks/[id]/grade` | 채점·저장과 과제·메모 수정의 5xx 및 예외 |
| `PATCH /api/weeks/[id]/grade-confirm` | 서술형 확정 트랜잭션의 5xx와 예외 |
| `POST /api/weeks/[id]/ocr-exam-photo` | 사진 저장·검증, OCR 호출 및 결과 저장의 5xx와 예외 |
| `POST/PATCH /api/weeks/[id]/exam-photo-job` | 채점 작업 시작·정리·검토 저장의 5xx와 예외 |
| `POST /api/weeks/[id]/grade-vocab-photo` | 시험·점수 조회 및 사진·채점 저장의 5xx와 예외, 422로 응답하는 OCR·AI 공급자 장애 |
| `POST /api/report-dispatch` | 성적표 게시·발송 5xx, 발송 기록 저장 실패, Solapi 접수 단계의 인증·제한·잔액·네트워크·서버 장애 |
| `POST /api/exam-bank`, `POST /api/exam-bank/[id]/upload-explanation` | 문제지·해설지 등록, 원본 접근, 워커 실행 요청, 동기 파싱·저장 실패 |
| Cloud Run `edunote-bank-pdf` | 문제지·해설지 작업이 DB에서 최종 실패로 확정된 경우. 자동 복구가 끝난 미완료 문항, 배치 중단, 작업 재시도 소진을 포함한다. |
| `POST /api/weeks/[id]/parse-vocab-pdf`, `parse-vocab-xlsx`, `vocab-words` | 단어장 PDF·엑셀 파싱 실패와 업로드에서 시작한 단어 저장 실패 |

입력 검증, 권한 거절, 채점 버전 충돌, 사진을 다시 촬영하라는 응답, 개별 전화번호 거절은 알림 조건에서 제외한다. 성적표 문자 발송이 HTTP 200으로 끝나더라도 확인된 Solapi 서비스 장애는 배치당 한 건을 기록한다. 오류 이벤트에는 고정 기능 코드, 실패 코드, 배포 버전만 담긴다. 카카오톡에는 기능명과 Sentry 이슈 링크를 보낸다.

## 한 번만 설정할 항목

1. [Vercel Marketplace의 Sentry](https://vercel.com/marketplace/sentry/sentry)에서 운영 EduNote 프로젝트를 연결한다. Sentry 프로젝트의 DSN을 `SENTRY_DSN`, 숫자 프로젝트 ID를 `SENTRY_ALERT_PROJECT_ID`, 조직의 이슈 도메인(예를 들어 `https://<organization>.sentry.io`)을 `SENTRY_ALERT_ISSUE_ORIGIN`에 등록한다.
2. [카카오디벨로퍼스](https://developers.kakao.com/)에서 카카오 로그인을 활성화하고 `talk_message` 동의 항목과 OAuth Redirect URI를 등록한다. 제품 링크 관리의 웹 도메인에 위 Sentry 이슈 도메인을 등록한다. 담당 개발자 계정으로 초기 로그인과 동의를 하고, [인가 코드를 토큰으로 교환](https://developers.kakao.com/docs/ko/kakaologin/rest-api#request-token)해 받은 리프레시 토큰을 `KAKAO_ALERT_INITIAL_REFRESH_TOKEN`에 입력한다. 앱의 REST API 키는 `KAKAO_ALERT_REST_API_KEY`, 클라이언트 시크릿이 활성화된 경우 그 값은 `KAKAO_ALERT_CLIENT_SECRET`에 입력한다. 인증 값과 토큰은 Vercel의 **Production** 환경변수에 저장한다.
3. [카카오 알림 마이그레이션](../supabase/migrations/20261118095239_kakao_operational_alerts.sql)을 프로젝트 규칙에 따라 개발 DB와 운영 DB의 SQL Editor에 적용한다. 운영 Vercel의 기존 `SUPABASE_SERVICE_ROLE_KEY`와 `CRON_SECRET`이 설정되어 있는지 확인한다.
4. Sentry에 [알림 액션용 내부 통합](https://docs.sentry.io/integrations/integration-platform/webhooks/issue-alerts/)을 만든다. 웹훅 URL은 운영 도메인의 `/api/webhooks/sentry-alert`로 지정하고 통합의 Client Secret을 `SENTRY_ALERT_WEBHOOK_SECRET`에 저장한다. `production`에서 새 이슈가 생성되거나 해결된 이슈가 재발하면 그 통합을 호출하도록 [알림](https://docs.sentry.io/product/monitors-and-alerts/alerts/create-alerts/)을 만든다. 카카오 전송 규칙에서는 `edunote_area:kakao-delivery`를 제외하고 이슈별 알림 빈도를 30분으로 제한한다. 인증 실패나 발송 장애 때도 알 수 있도록 운영 이메일 규칙은 별도로 둔다.
5. 설정을 반영해 운영에 배포한 뒤, `Authorization: Bearer <CRON_SECRET>` 헤더로 `POST /api/cron/kakao-alerts`를 한 번 호출한다. 응답 `202`, Sentry의 `EduNote alert-test: manual` 이슈, 나와의 채팅에 도착한 메시지, 메시지에서 열리는 이슈 링크를 확인한다. 다시 검증할 때는 기존 테스트 이슈와 알림 제한 시간을 확인한다.

일일 Cron은 05시 KST 시간대에 토큰과 오래된 발송 기록을 관리한다. 초기 토큰은 DB에 저장된 뒤 Vercel에서 제거할 수 있다. 카카오 동의를 다시 받아야 하면 새 리프레시 토큰을 발급하고, 새 값으로 `kakao_operational_token`의 단일 행을 갱신하면서 액세스 토큰과 만료 시각을 비운다. 같은 Sentry 이벤트는 한 번만 발송을 시도한다. 외부 발송에 실패하면 Sentry에서 `kakao-delivery` 오류를 확인할 수 있으며 이메일 규칙은 계속 적용된다.

워커 알림은 최신 `main`에서 [PDF 워커 이미지를 빌드](GCP_PDF_WORKER_SETUP.md)한 뒤 운영 `edunote-bank-pdf` Job에 반영한다. Job에 `PDF_WORKER_ALERT_ENV=production`을 설정하고 웹 운영과 동일한 `SENTRY_DSN`을 [Secret Manager로 주입](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)한다. Cloud Run 재시도 횟수는 현재 작업의 종료 판정과 동일하게 3회로 유지한다. 최종 상태가 DB에 기록되기 전에 컨테이너가 강제 종료된 작업은 이 알림 범위에 포함되지 않는다.
