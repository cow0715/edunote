# GCP PDF 워커 설정 — Vercel + Supabase 유지

웹과 인증·DB·파일 저장은 기존 서비스를 사용한다. PDF 등록 API는 작업을 저장하고 `202 + job_id`를 반환한다. Cloud Run Job은 원본 PDF를 읽고, 기존 파서를 실행하고, 결과를 저장한 뒤 종료한다. 브라우저를 닫아도 접수된 작업은 계속 처리한다.

이번 변경은 실행 위치를 옮기는 작업이다. 수특처럼 번호·지문 구성이 다른 자료를 기출 18~45번 파서가 자동 지원하도록 바꾸는 작업은 포함하지 않는다.

## 운영 적용 현황 (2026-10-15)

- GCP 프로젝트: `edunote-511708` / 번호 `931136004474` / 서울 `asia-northeast3`.
- Cloud Run Jobs: `edunote-bank-pdf`, `edunote-week-pdf`. 공통 이미지: `asia-northeast3-docker.pkg.dev/edunote-511708/edunote-workers/pdf-worker:20261015-v1`.
- 운영 Supabase: `rjaawwrcgegfjtiztsou`. 개발·운영 DB 모두 사용자가 마이그레이션을 적용했고, 테이블·RPC·비공개 원본 버킷을 조회 확인했다.
- Secret Manager의 두 운영 키 버전은 각각 `1`. runtime 계정에 해당 Secret 읽기만 부여했다. 운영 키 복사는 사용자가 명시적으로 승인했다.
- Vercel `edunote`의 Production에만 워커를 활성화했다. OIDC는 운영 팀 ID·프로젝트 ID·환경을 검사한다. dispatcher의 장기 JSON 키는 생성하지 않았다.
- Vercel 배포: `dpl_7BgUx3yxjJiRmjCdFp3oJmt36USm`, [배포 주소](https://edunote-duuutekhi-edunote.vercel.app). 기존 운영 커밋 `e50ff39d930ab731d50887938f17cc89b0182c05`에 워커 변경만 추가한 별도 폴더에서 배포했다. 작업 중인 다른 공유 화면 변경은 포함하지 않았다.
- 검증: `npm run check -- --maxWorkers=2` (764개 테스트 통과, 린트 오류 0), 워커 번들·웹 프로덕션 빌드 성공. Vercel 빌드의 실제 운영 OIDC 토큰으로 두 Job 실행 요청 성공. 두 컨테이너에서 `node build/pdf-worker.cjs --help` 실행 후 정상 종료 확인. 로그인 화면 HTTP 200, 앱 로그인 없는 작업 API는 로그인으로 307 리다이렉트.
- 사용자 요청으로 실제 PDF→AI→결과 저장까지 검증했다. 합성 문항 2개를 사용했으며 상세 결과는 아래 9단계의 실측 기록을 참고한다. 개발 환경의 워커 플래그는 계속 `false`다.

커밋·푸시는 수행하지 않았다. 다음 Git 기반 배포 전에 워커 변경을 반영해야 한다. 코드가 없는 기존 커밋으로 재배포하면 워커 기능도 되돌아간다. 되돌릴 때는 이전 배포를 승격하고 `PDF_IMPORT_WORKER_ENABLED=false`로 설정한 뒤 재배포한다. 이미 실행 중인 Cloud Run 작업은 별도로 확인한다.

## 구성

| 구성 | 역할 |
|---|---|
| Vercel | 로그인·소유권 검사, 등록·재실행 요청, 작업 조회 |
| Supabase `pdf_import_job` | 종류·대상·진행 상태·결과·워커 lease 저장 |
| Supabase `pdf_import_checkpoint` | 작업별 AI 응답 저장, 재시도 시 재사용 |
| Supabase `pdf-import-sources` | 재시도에 필요한 비공개 원본 보관 |
| Cloud Run `edunote-bank-pdf` | 문제은행 문제지/해설지 처리 |
| Cloud Run `edunote-week-pdf` | 주차 PDF 등록·기존 답안 재채점 |
| Artifact Registry / Cloud Build | Docker 이미지 보관 / 빌드·업로드 |
| Secret Manager | 워커의 Supabase service role 및 Anthropic 키 주입 |

`scripts/pdf-worker.ts`가 실행 프로그램, `Dockerfile.worker`가 컨테이너 제작법, `cloudbuild.worker.yaml`이 빌드·업로드 절차다. **코드 → Docker 이미지 → Cloud Run Job** 순서로 배포한다. 동일 이미지를 두 Job이 공유한다.

아래 명령은 **Windows PowerShell** 기준이다. 예시 이름을 바꾸면 Vercel 설정도 일치시킨다. 이미 만든 리소스의 `create` 명령은 반복하지 않는다.

## 1. Supabase 개발·운영 DB에 마이그레이션 적용

`supabase/migrations/20261013000001_pdf_import_jobs.sql` 전체를 각 프로젝트 SQL Editor에서 한 번 실행한다. 저장소 규칙에 따라 개발 DB와 운영 DB **둘 다 직접 적용**한다. 운영 워커는 운영 DB에, 개발 워커는 개발 DB에 연결한다.

확인할 항목: `pdf_import_job`, `pdf_import_checkpoint`, 비공개 `pdf-import-sources` 버킷, `pdf_import_claim/heartbeat/save_checkpoint/finish/retry/delete_exam` 함수. 기존 `exam-pdf-temp`, `answer-sheets` 버킷은 유지한다.

이 단계에서는 `PDF_IMPORT_WORKER_ENABLED=false`를 유지한다.

## 2. GCP 프로젝트·결제·CLI 준비

[Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 만들고 결제 계정을 연결한다. Billing의 Budgets & alerts에서 소액 예산 알림을 설정한다. 알림은 자동 과금 차단 기능이 아니다.

[Google Cloud CLI](https://docs.cloud.google.com/sdk/docs/install)를 Windows에 설치한 뒤 새 PowerShell을 연다. 최초 설정 계정에는 프로젝트 리소스 생성과 IAM 설정 권한이 필요하다. 직접 만든 개인 프로젝트의 소유 계정으로 진행한다.

```powershell
gcloud auth login
$PdfProject = "본인의-GCP-프로젝트-ID"
$PdfRegion = "asia-northeast3"
gcloud config set project $PdfProject
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com
```

서울 리전 예시다. 다른 리전을 쓰면 이미지 경로, Job, Vercel 설정도 같은 값으로 바꾼다.

## 3. 이미지 저장소·서비스 계정 생성

```powershell
gcloud artifacts repositories create edunote-workers --repository-format=docker --location=$PdfRegion
gcloud iam service-accounts create edunote-pdf-runtime --display-name="EduNote PDF runtime"
gcloud iam service-accounts create edunote-pdf-dispatcher --display-name="EduNote PDF dispatcher"
gcloud iam service-accounts create edunote-pdf-builder --display-name="EduNote PDF builder"
$PdfRuntime = "edunote-pdf-runtime@${PdfProject}.iam.gserviceaccount.com"
$PdfDispatcher = "edunote-pdf-dispatcher@${PdfProject}.iam.gserviceaccount.com"
$PdfBuilder = "edunote-pdf-builder@${PdfProject}.iam.gserviceaccount.com"
$PdfBuildSource = "gs://${PdfProject}-pdf-build-source"
$PdfBuildLogs = "gs://${PdfProject}-pdf-build-logs"
gcloud storage buckets create $PdfBuildSource --location=$PdfRegion --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets create $PdfBuildLogs --location=$PdfRegion --uniform-bucket-level-access --public-access-prevention
gcloud artifacts repositories add-iam-policy-binding edunote-workers --location=$PdfRegion --member="serviceAccount:$PdfBuilder" --role="roles/artifactregistry.writer"
gcloud storage buckets add-iam-policy-binding $PdfBuildSource --member="serviceAccount:$PdfBuilder" --role="roles/storage.objectViewer"
gcloud storage buckets add-iam-policy-binding $PdfBuildSource --member="serviceAccount:$PdfBuilder" --role="roles/storage.legacyBucketReader"
gcloud storage buckets add-iam-policy-binding $PdfBuildLogs --member="serviceAccount:$PdfBuilder" --role="roles/storage.objectAdmin"
gcloud storage buckets add-iam-policy-binding $PdfBuildLogs --member="serviceAccount:$PdfBuilder" --role="roles/storage.legacyBucketReader"
$PdfSetupAccount = gcloud config get-value account
gcloud iam service-accounts add-iam-policy-binding $PdfBuilder --member="user:$PdfSetupAccount" --role="roles/iam.serviceAccountUser"
gcloud iam service-accounts add-iam-policy-binding $PdfRuntime --member="user:$PdfSetupAccount" --role="roles/iam.serviceAccountUser"
```

builder는 지정한 소스 버킷 읽기·이미지 저장소 업로드·로그 버킷 기록 권한만 갖는다. 프로젝트 전체 Cloud Build 역할은 부여하지 않는다. `legacyBucketReader`는 버킷 메타데이터 확인에도 필요하다. runtime은 PDF 처리, dispatcher는 Vercel의 Job 실행 요청에 사용한다. runtime과 builder에는 JSON 키를 만들 필요가 없다. 조직 계정에서 IAM 변경이 막히면 관리자가 위 권한을 부여해야 한다. [사용자 지정 빌드 계정 안내](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts).

## 4. 워커 비밀값 등록

GCP 콘솔 → Secret Manager에서 아래 두 Secret을 만들고 첫 버전 `1`을 생성한다. **같은 대상 환경**의 기존 키를 사용한다.

| Secret 이름 | 값 |
|---|---|
| `edunote-supabase-service-role` | 운영 Supabase의 `SUPABASE_SERVICE_ROLE_KEY` |
| `edunote-anthropic-api-key` | 기존 `ANTHROPIC_API_KEY` |

키를 터미널 명령줄이나 저장소 파일에 넣지 말고 콘솔의 Secret 입력란에 붙여넣는다.

```powershell
gcloud secrets add-iam-policy-binding edunote-supabase-service-role --member="serviceAccount:$PdfRuntime" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding edunote-anthropic-api-key --member="serviceAccount:$PdfRuntime" --role="roles/secretmanager.secretAccessor"
```

[Cloud Run Jobs Secret 공식 안내](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets).

## 5. Docker 이미지 빌드

프로젝트 폴더에서 실행한다. 로컬 Docker 설치 없이 Cloud Build가 빌드한다. ignore 파일은 필요한 소스만 포함하고 환경변수·PDF·개인 설정 파일을 제외한다.

```powershell
Set-Location "C:\Users\pc\Desktop\edunote"
npm run check
npm run build:worker
npm run worker -- --help
$PdfImage = "${PdfRegion}-docker.pkg.dev/${PdfProject}/edunote-workers/pdf-worker:v1"
gcloud meta list-files-for-upload
gcloud builds submit . --region=$PdfRegion --config=cloudbuild.worker.yaml --ignore-file=.gcloudignore --service-account="projects/$PdfProject/serviceAccounts/$PdfBuilder" --gcs-source-staging-dir="$PdfBuildSource/source" --gcs-log-dir="$PdfBuildLogs/logs" --substitutions="_IMAGE=$PdfImage"
```

`list-files-for-upload`로 전송 목록을 확인한다. 로컬 worker 빌드는 Node.js 24 기준이다. `--help`는 DB·AI에 접속하지 않는다. Cloud Build 성공 후 Artifact Registry에 `v1` 이미지가 생긴다.

## 6. Cloud Run Job 두 개 배포

Supabase URL에는 운영 프로젝트 URL을 넣는다. Secret의 서비스 키도 같은 프로젝트여야 한다.

```powershell
$PdfSupabaseUrl = "https://운영프로젝트.supabase.co"
foreach ($PdfJobName in @("edunote-bank-pdf", "edunote-week-pdf")) {
  gcloud run jobs deploy $PdfJobName --image=$PdfImage --region=$PdfRegion --service-account=$PdfRuntime --tasks=1 --parallelism=1 --cpu=1 --memory=2Gi --task-timeout=3600s --max-retries=3 --set-env-vars="NEXT_PUBLIC_SUPABASE_URL=$PdfSupabaseUrl,PDF_WORKER_CONCURRENCY=2" --set-secrets="SUPABASE_SERVICE_ROLE_KEY=edunote-supabase-service-role:1,ANTHROPIC_API_KEY=edunote-anthropic-api-key:1"
}
```

초기값은 1 vCPU / 2 GiB / 실행 시 최대 1시간 / 실패 시 3회 재시도다. PDF 하나당 task 하나가 실행되고, 그 안에서 AI 요청은 기본 2개씩 처리한다. `--parallelism=1`은 한 실행 안의 task 수를 제한한다. 서로 다른 PDF의 전체 실행 수 제한은 아니므로 처음에는 파일 1~2개씩 등록한다.

Job의 기본 `PDF_IMPORT_JOB_ID`는 설정하지 않는다. Vercel이 실행마다 작업 UUID를 넘긴다. PORT를 열거나 도메인을 연결할 필요가 없다. [Job 생성 공식 안내](https://docs.cloud.google.com/run/docs/create-jobs).

## 7. Vercel 호출 계정에 Job 실행 권한 부여

```powershell
foreach ($PdfJobName in @("edunote-bank-pdf", "edunote-week-pdf")) {
  gcloud run jobs add-iam-policy-binding $PdfJobName --region=$PdfRegion --member="serviceAccount:$PdfDispatcher" --role="roles/run.jobsExecutorWithOverrides"
}
```

환경변수 override로 작업 ID를 넘기므로 `run.jobs.runWithOverrides` 권한이 필요하다. 권한은 두 Job에만 부여한다. [해당 IAM 역할](https://docs.cloud.google.com/iam/docs/roles-permissions/run).

Vercel OIDC와 GCP Workload Identity Federation을 연결한다. 장기 JSON 키를 생성하지 않고, 요청마다 Vercel이 주입한 `x-vercel-oidc-token`을 GCP 단기 토큰으로 교환한다. dispatcher에는 Supabase·AI Secret 읽기나 프로젝트 관리 권한을 부여하지 않는다.

Vercel 프로젝트 Settings → Security → OIDC에서 issuer mode를 `Team`으로 설정한다. 다음 예시의 팀 slug/ID, 프로젝트 ID/이름은 실제 Vercel 값으로 바꾼다. 현재 운영 프로젝트는 아래 값과 일치한다.

```powershell
$PdfProjectNumber = "931136004474"
$PdfVercelTeam = "edunote"
$PdfVercelProject = "edunote"
gcloud iam workload-identity-pools create edunote-vercel --location=global --display-name="EduNote Vercel production"
$PdfOidcFlags = @{
  '--workload-identity-pool' = 'edunote-vercel'
  '--location' = 'global'
  '--issuer-uri' = "https://oidc.vercel.com/$PdfVercelTeam"
  '--allowed-audiences' = @("https://vercel.com/$PdfVercelTeam")
  '--attribute-mapping' = @{ 'google.subject' = 'assertion.sub' }
  '--attribute-condition' = "assertion.owner_id == 'team_JTQrrG2HPaNAoROrRo0jWjLC' && assertion.project_id == 'prj_v1VEwG4fcmGPClZEbH3Dqcurh3hU' && assertion.environment == 'production'"
}
$PdfOidcFlags | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 "$env:TEMP/edunote-oidc.json"
gcloud iam workload-identity-pools providers create-oidc vercel --flags-file="$env:TEMP/edunote-oidc.json"
$PdfPrincipal = "principal://iam.googleapis.com/projects/$PdfProjectNumber/locations/global/workloadIdentityPools/edunote-vercel/subject/owner:${PdfVercelTeam}:project:${PdfVercelProject}:environment:production"
gcloud iam service-accounts add-iam-policy-binding $PdfDispatcher --member=$PdfPrincipal --role=roles/iam.workloadIdentityUser
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com
```

팀·프로젝트 이름 또는 issuer mode를 바꾸면 신뢰 설정도 함께 바꾼다. Preview/Development 토큰은 이 설정으로 운영 Job을 실행할 수 없다. [Vercel GCP OIDC 안내](https://vercel.com/docs/oidc/gcp), [토큰 claims 안내](https://vercel.com/docs/oidc/reference).

## 8. Vercel 환경변수 설정·재배포

Vercel 프로젝트 → Settings → Environment Variables에서 Production에 아래 값을 설정한다. Preview/Development는 별도 DB·Job·Secret을 준비했을 때만 활성화한다.

| 환경변수 | 값 |
|---|---|
| `PDF_IMPORT_WORKER_ENABLED` | `true` |
| `GCP_PROJECT_ID` | 본인 프로젝트 ID |
| `GCP_WORKER_REGION` | `asia-northeast3` |
| `GCP_BANK_PDF_JOB` | `edunote-bank-pdf` |
| `GCP_WEEK_PDF_JOB` | `edunote-week-pdf` |
| `GCP_WORKLOAD_IDENTITY_AUDIENCE` | `//iam.googleapis.com/projects/931136004474/locations/global/workloadIdentityPools/edunote-vercel/providers/vercel` (본인 프로젝트 번호 사용) |
| `GCP_WORKER_SERVICE_ACCOUNT_EMAIL` | `edunote-pdf-dispatcher@본인프로젝트.iam.gserviceaccount.com` |

위 값은 모두 서버 설정이다. 기존 Supabase·AI 환경변수는 다른 기능에서도 사용하므로 유지한다. Vercel과 워커의 Supabase URL·service role 키는 같은 DB를 가리켜야 한다. `GCP_WORKER_SERVICE_ACCOUNT_JSON`은 과거 JSON 방식의 호환용이며 이번 설정에서는 등록하지 않는다. OIDC 설정이 있으면 JSON 키를 사용하지 않는다.

코드를 배포하고 환경변수가 적용되도록 Redeploy한다. 플래그가 `false`이거나 없으면 기존 동기 API가 실행된다. `true`일 때 설정이 잘못되면 접수 오류 또는 재실행 안내를 보여주며 동기 파싱으로 자동 전환하지 않는다.

## 9. 작은 PDF 한 개로 연결 확인

실제 PDF 등록은 기존 AI API 과금이 발생하므로 작은 파일 한 개부터 직접 확인한다.

### 2026-10-15 운영 실측

Chrome의 기존 운영 로그인 세션에서 실제 등록 UI를 사용했다. 원문은 테스트용 합성 자료이며 18·19번 문항 2개, 정답 ②·③, 해석·풀이를 포함했다. 실제 학생·수업의 문항이나 답안은 수정하지 않았다.

| 경로 | 실행 / 작업 | 결과 |
|---|---|---|
| 문제은행 문제지+해설지 | `edunote-bank-pdf-mcbnh` / `74bc7f4b-7ca8-4ca7-851e-a94a8725784f` | 약 86초, 문항 2개·해설 2개·어휘 보완 저장, 체크포인트 52개, 첫 시도 성공 |
| 주차 통합 PDF | `edunote-week-pdf-8clnq` / `c82522d9-a98a-499e-9a46-58cc39eb24c4` | 접수부터 DB 완료까지 약 106초, 문항·정답·해설 2개, 체크포인트 4개, 첫 시도 성공 |
| 기존 채점 연결 | 연락처 없는 합성 학생 1명 | 답안 ②·③ 입력·저장 후 두 답안 `is_correct=true`, 현황 화면 `2/2` 확인 |

문제은행 등록 중 다이얼로그를 닫고 새로고침해도 작업이 이어져 완료됐다. 두 Cloud Run 실행 모두 `Completed=True`, `succeededCount=1`이었다. 주차 Job은 시작 대기 약 89초 후 컨테이너 실행 약 20초로 완료됐다. 따라서 접수 즉시 파싱이 시작된다고 보장하지는 않는다. Vercel 요청은 이 대기를 계속 잡고 있지 않았다.

완료 작업의 중복 실행 검사는 자동 승인 검토가 추가 과금·중복 저장 가능성을 이유로 차단하여 수행하지 않았다. 이번 검증은 소형 합성 자료의 연결 확인이다. 100페이지 이상 자료, 실제 수특 형식 지원, 장애 후 체크포인트 재사용, 기존 학생 답안의 재채점은 별도 실측하지 않았다.

검증 후 합성 데이터 정리 SQL은 실행이 취소되어 적용되지 않았다. 확인용 자료는 운영에 남아 있다: 문제은행 `2099년 4월 고3 모의고사`, 수업 `[워커 테스트] 2026-10-15`, 학생 `[워커테스트] 합성학생`. [검증 주차 열기](https://edunote-psi.vercel.app/dashboard/69f02dba-e907-4751-a83a-fb3ab83e9c2e/weeks/fcf37100-c45a-4004-a20c-5d2284915746). 학생 연락처는 비워 두었고 문자 발송은 실행하지 않았다. 원본 테스트 PDF와 체크포인트도 남아 있으므로 정리 시 함께 제거한다.

1. 문제은행에 기존 기출 PDF 하나를 등록한다. POST 응답이 `202`, `job_id`를 포함하는지 확인한다.
2. Cloud Run → Jobs → `edunote-bank-pdf` → Executions에서 실행 생성을 확인한다.
3. 앱의 작업 상태가 대기 → 실행 → 완료로 바뀌고 기존 문제 목록에 결과가 반영되는지 확인한다.
4. 문제지+해설지를 함께 올리면 워커가 이어서 처리하는지 확인한다.
5. 주차 PDF도 등록해 `edunote-week-pdf`, 문항·정답·해설, 재채점 결과를 확인한다.
6. 접수 후 탭을 닫았다가 돌아와도 작업 상태가 남는지 확인한다.

기존 학생 답안이 있으면 기존 경고·동의를 유지한다. 접수 후 파싱 중 문항·답안이 바뀌면 첫 저장 전에 중단한다. 저장은 기존 여러 DB 작업을 사용하므로 전체 트랜잭션은 아니다. 일부 저장 뒤 실패하면 작업 재실행으로 AI 응답을 재사용하고 다시 반영한다. 적용 도중에는 해당 주차 문항·답안을 편집하지 않는다.

## 10. 재시도·업데이트·비용 관리

- 30초마다 2분 lease를 갱신한다. 동일 작업에 살아 있는 lease가 있으면 다른 워커가 처리하지 않는다. 비정상 종료 시 lease 만료 후 재시도한다.
- 워커의 AI 요청은 요청당 180초 제한과 SDK 재시도 2회를 사용한다. task 전체 시간 제한은 별도다. 완료된 JSON 응답을 작업별로 저장한다. 저장 전 끊긴 호출·캐시 예열·잘린 응답은 다시 호출될 수 있다.
- 실패·실행 요청 불확실·오래 대기하는 작업은 앱의 **재실행** 버튼을 사용한다. 새 업로드는 새 작업이라 이전 응답 캐시를 공유하지 않는다.
- 원본과 체크포인트의 자동 청소는 아직 없다. Supabase 용량을 확인하고 필요 없는 완료 작업의 원본을 정리한다. 원본 위치는 작업의 `source_path`, 선택 해설은 `payload.explanationSourcePath`다. 주차 열람용 원본은 기존 `answer-sheets`에 별도로 남는다.
- 콘텐츠 필터로 건너뛴 번호 등 결과 경고도 작업 결과에 저장한다. 기존 통계·어휘 보완, 태그·재채점 기능을 이어서 실행한다.
- 처리 중인 문제은행 자료는 완료 후 삭제한다. 자료 삭제 시 관련 작업·체크포인트도 함께 삭제하므로 실패 작업의 재실행으로 자료가 다시 생기지 않는다. 원본 스토리지 파일은 별도로 남으므로 삭제 전에 경로를 기록해 정리한다.
- 워커 변경 시 `v2`, `v3`처럼 새 이미지 태그로 빌드한 뒤 두 Job의 `--image`를 업데이트한다. 같은 태그 덮어쓰기만으로 기존 Job의 digest가 바뀌지 않을 수 있다. 웹 코드 변경은 Vercel도 따로 배포한다.
- Secret 교체 시 새 버전을 만들고 Job의 Secret 버전도 바꾼다. 운영·개발을 나누려면 Job·Secret 이름과 DB 연결을 각각 분리한다.
- Cloud Run Jobs는 실행 중 할당 CPU·메모리에 과금하며 task당 최소 1분이다. AI 응답 대기 시간도 포함된다. 미실행 시 워커 컴퓨팅 요금은 없다. 빌드·이미지 보관·네트워크·Secret Manager·Supabase·AI API는 별도이며 전체 무료를 보장하지 않는다. [Cloud Run 요금](https://cloud.google.com/run/pricing).
- 시간 초과 시 로그와 체크포인트 수를 확인한다. 필요하면 1시간 제한을 늘리고, 429 발생 시 `PDF_WORKER_CONCURRENCY=1`, 메모리 부족 시 Job 메모리를 조정한다. 우선 실제 처리 시간·AI 비용을 측정한다.

수동 실행은 이미 등록된 작업 UUID를 전달한다. 완료된 작업은 재파싱하지 않고 종료한다.

```powershell
$PdfJobId = "pdf_import_job의-실제-UUID"
gcloud run jobs execute edunote-bank-pdf --region=$PdfRegion --update-env-vars="PDF_IMPORT_JOB_ID=$PdfJobId"
```

실패 상태는 앱의 재실행 버튼으로 먼저 되돌린다. 오류 로그에 서비스 키나 문서 전문을 붙여넣지 않는다.

설정 자료 확인일: 2026-10-15. 실제 배포 현황은 GCP 콘솔에서 확인한다. 실제 PDF 등록 검증에는 AI API 과금이 발생한다.

## 11. 좌본문·우해석 교재의 자동 검증·복구·등록

`supabase/book_pdf_setup.sql`은 교재 테이블·자동 검증·AI 풀이/어휘 보완 마이그레이션 세 개를 순서대로 합친 설치용 SQL이다. 2026-10-19 사용자 적용 후 개발·운영 DB 모두 교재 테이블, 보완 컬럼, 최신 stage/proof 함수를 조회해 생성 여부를 확인했다. 교재의 월·학년은 NULL로 허용하되 기출의 필수 메타데이터 조건은 유지한다. 원본 PDF는 비공개 `pdf-import-sources`에 보관하고 소유자에게만 10분 유효 링크를 발급한다.

새 웹은 `material_kind`, `source_document_id` 컬럼을 조회하므로 **SQL 적용 전 배포하지 않는다.** 새 워커 이미지가 `bank_book`을 처리하는지 확인한 다음에만 Vercel의 `BOOK_PDF_IMPORT_ENABLED=true`를 활성화한다. 이전 이미지는 이 종류를 지원하지 않는다. 기출 업로드와 주차 PDF API 경로는 유지한다.

기출문제 은행 → **교재 등록·처리**에서 PDF를 올린다. 이후는 워커가 자동 처리하며 사람의 묶음별 확인이나 재요청을 요구하지 않는다. 현재 지원 범위는 `[수능특강(영어) N강 Gateway/N번]` 표기가 있는 좌본문·우해석 자료다. 다른 형식이나 스캔 PDF는 원문 경계를 확정하지 못하면 등록을 막는다. 범용 자동 파서를 보장하지 않는다.

공통 워커는 자료 종류별 처리기를 호출한다. `week_answers`와 `bank_questions`는 기존 번호 발견/예열·문항별 출력 파싱을 유지하며 풀이·어휘 보완도 유지한다. 기존 기출 해설 프롬프트의 보완 작성 규칙은 순수 계약 모듈 `src/lib/llm/material-enrichment-contract.ts`로 공유한다. 최신 운영의 작업별 모델 라우팅을 유지하며 교재 매핑·이미지 검증·보완은 별도 book 작업으로 Sonnet 5.5를 사용한다. 워커 체크포인트는 작업·모델·설정 버전·입력으로 구분하고 실행 ID나 AbortSignal은 재사용 키에서 제외한다. 기존 주차별/기출의 운영 모델 설정은 유지한다.

`bank_book`은 `20261019110610_book_native_worker_enrichment.sql`을 개발·운영 DB에 적용한 뒤 새 이미지로 배포한다. 교재 테이블이 아직 없는 DB에는 이전 교재 마이그레이션 두 개도 필요하다. `supabase/book_pdf_setup.sql`은 이 세 파일을 순서대로 합친 설치용 SQL이며, 두 DB의 SQL Editor에서 전체를 각각 실행할 수 있다. 원문 경계 조사는 기존 수능특강 좌본문·우해석 식별표기 전용이며, 임의 교재나 스캔 문서의 범용 경계 탐지를 보장하지 않는다. 경계 조사 후 연결 페이지 전체를 지문 묶음으로 복사하고 다음 순서로 처리한다.

1. PDF.js로 글자·좌표·서식을 읽고 Sonnet에 원문 참조 매핑을 요청한다. 신규 교재 작업은 아래 Batch API 경로로 처리한다. 교재 코드 선연결(hybrid) 실험 경로는 제거했으며, 장별 예열은 사용하지 않는다. 기존 주차별·기출 처리기의 동작은 유지한다.
2. Poppler(`pdftoppm`, Docker 이미지에 포함)로 원본 페이지를 높이 2000px PNG로 렌더링한다. PDF.js 추출 텍스트와 다른 경로의 시각 기준이다.
3. 원본 이미지로 내용·연결·서식을 대조하고, 최대 두 차례 해당 필드만 복구한 뒤 새 검증 호출로 확인한다. 매핑 형식/누락 재요청은 한 번으로 제한한다.
4. 검증된 원문을 별도 체크포인트에 저장하고, 그 텍스트만으로 추가 풀이·어휘를 작성한다. 생성 결과는 `book_pdf_unit.enrichment`, 원문은 `extraction`에 따로 저장한다. 보완 단계의 네트워크 실패로 재시작해도 원문 검증 체크포인트를 재사용한다.
5. 원문 이미지 검증과 보완 문항 대응이 모두 유효할 때만 등록한다. 문제은행에는 원문 해설·어휘를 보존하고 `[AI 보완 풀이]`/`[AI 보완 어휘]`를 덧붙인다. 원문 수정 시 보완 결과와 검증은 무효화된다.

한 교재 작업에서 동시에 처리하는 묶음은 최대 2개이며, 묶음당 최대 4페이지를 지원한다. 더 큰 묶음이나 확정되지 않은 경계는 잘라서 등록하지 않고 보류한다. 렌더링은 현재 묶음만 수행하고 임시 파일을 정리한다. 이 제한은 파일 여러 개의 동시 실행 수를 제한하지 않는다. API 동시성 환경변수의 전체 범위는 1~32이며 기존 주차별·기출 동작에는 변화가 없다. 메모리와 처리 시간은 실제 운영에서 별도로 확인한다.

프로토콜 2는 단일 모델의 별도 원본 이미지 대조와 원문/이미지/매핑/보완 해시를 기록한다. 프로토콜 1의 기존 두 모델 검증 기록도 호환된다. 모델의 승인이나 해시는 100% 판독 정확도의 보증이 아니다. 새 115페이지 전체 AI 실행과 보완 생성 비용은 아직 실측하지 않았으며, 앞선 파싱 비용 추정에는 새 보완 호출 비용이 포함되지 않는다.

이전 프로토콜 1의 두 모델 재추출 로직은 기존 검증 기록의 호환성과 회귀 테스트를 위해 남겨두지만 새 교재 워커에서 호출하지 않는다. 새 프로토콜의 원문 구역 누락·중복·범위 오류는 코드로 검사하고, 의미적 역할·해설 소속·문장·서식은 원본 이미지로 대조한다. 이미지 검증 후 복구가 있었다면 새 검증 호출이 통과해야 한다.

원본 이미지로 복구한 글자는 PDF.js가 잘못 읽은 문자열과 다를 수 있다. 새 경로에서는 그 차이만으로 올바른 복구를 다시 거절하지 않으며, 경계 조사 문항·정답과의 충돌은 보류한다. 모델의 오독 가능성이 있으므로 실제 정답셋으로 별도 성능을 측정해야 한다. 도표는 원본 PDF를 보존하고 링크한다. 텍스트 복사만으로 도표를 재현한다고 보장하지 않는다.

통과한 묶음은 검증 버전, 원본 PDF 해시, 원문 범위 해시, 추출 결과 해시, 사용 모델과 검사 결과를 보관한다. 변경된 내용에는 기존 통과 기록을 재사용할 수 없다. 저장된 `reviewed_version` 같은 구형 사람 확인 필드는 등록 조건으로 사용하지 않는다. 수정은 검증 기록을 무효화하며, 자동 검증 RPC는 살아 있는 worker lease만 허용한다. 네트워크 장애 재실행은 검증 완료 묶음과 AI 체크포인트를 재사용한다.

품질 복구 한도에 도달한 작업은 앱의 작업 DB에 `failed`와 사유를 기록한다. Cloud Run 프로세스는 종료해 같은 불일치 결과를 플랫폼이 다시 과금하며 반복하지 않게 한다. 앱에서도 같은 결과의 재실행 버튼은 제공하지 않는다. 네트워크·실행 장애는 기존 lease/체크포인트 재시도를 유지한다. 완료 화면은 통과 개수와 미해결 사유를 우선 표시하고 전체 문항 내역은 접어둔다.

모든 묶음이 통과하면 워커가 문제은행·어휘·교재 단어장을 한 트랜잭션으로 자동 등록한다. 중간 오류는 전체 롤백한다. 파일명 2026과 인쇄 학년도 2027이 다르면 단일 인쇄 학년도를 자동 적용하고 출처 차이를 기록한다. 인쇄 학년도를 확정할 수 없으면 NULL로 보관한다. 이 메타데이터 때문에 문항별 사람 확인을 요구하지 않는다.

등록 후에는 기존 자료 목록·문제 검색·선택/전체 복사·해설·단어장/CSV를 사용한다. 교재 원문 번호는 별도 출처 필드에 보존하고 화면·복사에는 `20강 3번`처럼 표시한다. 내부 순번은 반복 번호 충돌을 피하기 위한 값이다. 도표 문항도 보존하고 원본 PDF 링크를 제공한다. 교재에는 메가스터디 기출 통계와 기출 전용 해설 파서를 적용하지 않는다. 단어 빈도는 공통 지문의 문항 수가 아니라 지문 묶음 수로 센다.

로컬 검증: 실제 115페이지 PDF의 네이티브 텍스트에서 지문 묶음 104개·문항/정답 119개를 식별했다. 이는 AI 추출 결과의 의미적 정확성 검증과 다르다. 경계·누락·등록 조건 유닛테스트 및 로컬 PostgreSQL에서 SQL 재적용, 최신 버전/권한 검증, 전체 롤백, 어휘 빈도, 삭제 연쇄 동작을 검증했다. 실제 문서를 외부 AI API로 전송하는 테스트와 운영 활성화는 별도 확인이 필요하다.


### 2026-10-21 실자료 복구 경로 보완

매핑 모델이 보고한 PDF.js 글자 깨짐·원문 특이점은 구조 오류와 분리해 원본 이미지 대조로 넘긴다. 범위 초과·본문 누락·중복·잘못된 문항 ID는 계속 차단한다. 본문 내부에 섞인 보이지 않는 잔상 글자는 매핑에서 임의 제외하지 않고 원문 필드에 남겨 별도 이미지 복구로 제거한다. PDF 디코딩으로 닫는 괄호만 빠진 정확한 표제는 허용하되 그 뒤의 본문을 표제로 숨길 수 없다.

보완 JSON의 필드명·문항 대응 오류는 원문 재파싱 없이 텍스트 보완 단계에서 한 번만 피드백 복구한다. 네트워크 실패는 기존 재시도 정책을 유지한다. 새로운 복구 정책 revision이 배포된 경우에만 이전 revision에서 보류된 묶음을 다시 시도하고, 동일 revision의 복구 예산 소진은 계속 재실행을 차단한다. 통과한 묶음·검증된 원문 체크포인트는 재사용하며 동일 PDF를 새 작업으로 업로드하지 않는다.

### 2026-10-21 신규 교재: Batch API와 종료 후 자동 재개

신규 교재 접수 API는 `payload.bookProcessing=batch-v1`을 기록한다. 이 작업의 `book.mapSource`, `book.auditSource`, `book.enrichMaterial`만 Anthropic Message Batches로 전송한다. 모델(Sonnet 5.5)과 원문 대조·복구·풀이/어휘 보완 규칙은 유지한다. 기존 교재 작업에는 이 플래그가 없으므로 원래 경로로 재개하며, 기출·주차별은 기존 예열/실시간 요청을 그대로 사용한다. 코드 선연결 실험은 제거했다.

워커는 빠진 응답을 모아 배치를 제출하고 `book_pdf_batch`에 접수 ID·요청 식별자·결과 코드를 보관한다. PDF base64와 프롬프트는 이 테이블에 저장하지 않는다. 지문별 원문 처리 동시성은 2개, 수집하는 요청 JSON은 실행당 최대 32MiB/1,000개로 제한한다. 나머지는 다음 실행에서 이어간다. 결과는 요청 순서 대신 `custom_id`로 대응하고, 성공한 응답과 검증된 원문은 체크포인트에서 재사용한다. JSONB의 키 순서 차이 때문에 동일한 보완 요청이 다시 과금되지 않도록 입력을 스키마 순서로 정규화한다.

Cloud Tasks에 **5분 뒤 같은 교재 작업 실행**을 먼저 예약한 후 유료 배치를 접수한다. 예약이 실패하면 AI 요청을 보내지 않는다. 이후 DB를 `waiting_batch`로 바꾸면서 lease를 반환한 뒤 종료한다. 대기 중인 컨테이너·폴링 루프는 없다. 예약 실행은 배치가 아직 처리 중이면 원본 PDF를 다운로드하거나 렌더링하지 않고 다음 확인만 예약한다. 모든 배치가 완료되면 기존 파이프라인을 체크포인트부터 재개한다. 단계별 대기가 누적될 수 있으며, 하나의 배치가 26시간 넘게 미완료이면 중단 사유를 기록한다. 실패한 조회/재개 인프라는 기존 Cloud Run 최대 3회 재시도(최초 포함 4번)를 유지한다.

재시도 제한은 별개다:

| 종류 | 한도 |
|---|---|
| 일시적인 개별 배치 실패(api_error/overloaded/rate_limit/timeout/expired) | 같은 요청 최초 포함 최대 3회 접수. 성공한 요청은 재접수하지 않음 |
| 매핑 형식·누락 교정 | 최초 + 교정 1회 |
| 원본 부분 복구·새 이미지 대조 | 복구 최대 2회, 대조 최대 3회 |
| 풀이·어휘 JSON 교정 | 최초 + 교정 1회 |
| 배치 처리 중 상태 확인 | 위 AI 재요청 횟수를 소모하지 않음 |

취소·잘못된 요청 등 영구 오류는 자동 재접수하지 않는다. 배치 생성 POST는 SDK 재시도를 끈다. 응답 단절·DB 저장 실패로 접수 여부가 불확실하면 `batch_stopped`로 중단하고, 운영자가 Anthropic의 실제 배치 ID와 DB 기록을 대조하기 전에는 재실행 버튼을 막는다. `submitting` 행을 지우고 무조건 재접수하면 중복 과금될 수 있다. 한도는 DB 접수 이력과 체크포인트에 남으므로 컨테이너 재시작이나 수동 재실행으로 초기화되지 않는다.

Cloud Tasks의 Job 실행 요청 전달에는 `maxAttempts=5`, `maxRetryDuration=1800s`를 설정한다. Google의 정책상 두 조건을 모두 충족해야 중단되므로 이 값은 엄격한 최대 5회가 아니다. 반면 유료 AI 요청의 3회 한도는 DB에서 별도로 강제한다. 예약 시각보다 30분 넘게 상태 확인이 지연되면 앱에서 사유와 재실행을 제공한다. 이는 같은 작업의 기존 배치 ID를 다시 조회하는 복구이며, 성공 응답을 새로 생성하거나 AI 재요청 한도를 초기화하지 않는다. [Cloud Tasks 재시도 조건](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/RetryConfig).

배포 순서:

1. `20261021150000_book_pdf_batches.sql`을 개발·운영 SQL Editor에 각각 적용한다. 신규 DB용 `supabase/book_pdf_setup.sql`에도 포함돼 있다. `waiting_batch`도 활성 작업으로 취급해 중복 접수와 처리 중 삭제를 막는다.
2. 다음 Cloud Tasks 큐·전용 dispatcher 권한을 설정한다. 새 JSON 키는 만들지 않는다. 런타임의 `serviceAccountUser`는 이 전용 계정을 작업의 OAuth 계정으로 지정하는 데 필요하다. 전용 dispatcher에는 문제은행 Job 실행 권한만 준다.
3. 새 워커 이미지를 빌드하고, 문제은행 Job에 아래 환경변수를 추가한 뒤 배포한다. 주차 Job의 설정은 바꾸지 않는다.
4. 워커 준비 후 새 웹을 배포한다. 기존 115페이지 등록 결과를 다시 업로드할 필요는 없다. 실제 Batch API 전송 테스트는 별도 요청 없이 실행하지 않는다.

```powershell
$PdfProject = 'edunote-511708'
$PdfRegion = 'asia-northeast3'
$BookDispatcher = "edunote-book-batch-dispatcher@${PdfProject}.iam.gserviceaccount.com"
$PdfRuntime = "edunote-pdf-runtime@${PdfProject}.iam.gserviceaccount.com"
gcloud services enable cloudtasks.googleapis.com --project=$PdfProject
gcloud iam service-accounts create edunote-book-batch-dispatcher --project=$PdfProject
gcloud tasks queues create edunote-book-batch --project=$PdfProject --location=$PdfRegion --max-dispatches-per-second=1 --max-concurrent-dispatches=1 --max-attempts=5 --min-backoff=30s --max-backoff=300s --max-retry-duration=1800s
gcloud run jobs add-iam-policy-binding edunote-bank-pdf --project=$PdfProject --region=$PdfRegion --member="serviceAccount:$BookDispatcher" --role=roles/run.jobsExecutorWithOverrides
gcloud iam service-accounts add-iam-policy-binding $BookDispatcher --project=$PdfProject --member="serviceAccount:$PdfRuntime" --role=roles/iam.serviceAccountUser
gcloud tasks queues add-iam-policy-binding edunote-book-batch --project=$PdfProject --location=$PdfRegion --member="serviceAccount:$PdfRuntime" --role=roles/cloudtasks.enqueuer
gcloud run jobs update edunote-bank-pdf --project=$PdfProject --region=$PdfRegion --update-env-vars="GCP_PROJECT_ID=$PdfProject,GCP_WORKER_REGION=$PdfRegion,GCP_BANK_PDF_JOB=edunote-bank-pdf,GCP_BOOK_BATCH_QUEUE=edunote-book-batch,GCP_BOOK_BATCH_DISPATCH_ACCOUNT=$BookDispatcher"
```

위 create 명령은 처음 설정할 때만 실행한다. 같은 이름의 큐·계정이 이미 있으면 재생성하지 않고 설정을 확인한다.

참고: [Anthropic Batch API](https://platform.claude.com/docs/en/build-with-claude/batch-processing), [Cloud Tasks OAuth](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks), [Job 실행 권한](https://docs.cloud.google.com/iam/docs/roles-permissions/run).

## 수능·모의고사 등록 Batch 확장 (2026-10-23)

- 먼저 `supabase/migrations/20261023113525_exam_bank_batch_imports.sql`을 개발·운영에 적용한 뒤 워커와 Vercel을 배포한다. 기존 교재 배치 ID·성공 체크포인트·자료는 유지한다.
- 새 `bank_questions`, `bank_explanation` 작업에 `payload.batchProcessing=batch-v1`을 서버에서 기록한다. 이미 접수한 일반 API 작업과 주차별·채점 경로는 전환하지 않는다.
- 문제지·해설지는 별도의 원본 파일로 보관한다. 함께 올리면 문제지 문항별 파싱 Batch → 문항 저장·통계 → 해설지 문항별 추출/풀이·어휘 보완 Batch → 어휘 관계 보강 Batch 순서다. 해설만 나중에 올리면 기존 문제지를 파싱하지 않는다.
- 기존 모델·프롬프트·18~45번 문항별 출력 단위를 유지한다. 예열 요청은 생성하지 않고 문항별 요청을 Batch에 모아 제출한다. 정상 결과가 있는 요청과 완료된 저장 단계는 재실행하지 않는다.
- 대기 중 워커는 종료한다. 기존 `edunote-book-batch` 큐·재개 계정과 `edunote-bank-pdf` Job을 재사용하고 5분 간격으로 상태를 확인한다. 각 의존 단계마다 별도 배치 대기 시간이 발생할 수 있다.
- 어휘 보강의 40개 단위 요청도 한 번에 수집한다. 후보 목록을 체크포인트에 고정해 부분 저장 후 재개하더라도 요청 식별자가 바뀌지 않는다.
- 일시 실패한 요청만 최초 포함 최대 3회 접수한다. 취소·잘못된 요청 등 확정 실패와 한도 소진은 실패로 표시하고 자동 재접수를 중단한다. 접수 여부 불명 상태도 중복 과금을 피하기 위해 중단한다.
- DB의 `book_pdf_batch`와 RPC 이름은 진행 중인 교재와의 호환성을 위해 유지하되, 작업 종류별 허용 task를 검증한다. 주차·채점 task는 이 배치 전송부에서 허용하지 않는다.
- Batch 토큰 단가는 일반 API 대비 50%지만 캐시 적중은 보장되지 않는다. 실제 총비용·시간 비교는 별도 승인된 실테스트에서 확인하며, 배포·검증 단계에서 재파싱하지 않는다.


## 주차 정답 검토 경로 배포 순서 (2026-10-23)

주차 PDF는 이제 문제지·해설지 원본 세트를 보관하고 `week_answer_draft` 초안만 생성한다.
원문 정답 근거가 없으면 정답을 비우며 강사 검토·확정 전에는 문항/정답/학생 답안을 변경하지 않는다.
기존 시험은 동일한 문항 구성·정답을 유지한 상태로만 확정한다. 다른 시험은 새 주차에 등록한다.

1. `supabase/migrations/20261023150000_week_answer_review.sql`을 개발·운영 DB에 적용한다.
2. 새 소스의 PDF 워커 이미지를 빌드하고 주차 Cloud Run Job을 업데이트한다.
3. 업데이트된 워커가 검토 초안을 생성하는 것을 확인한 후 Vercel의 `WEEK_ANSWER_REVIEW_WORKER_READY=true`를 설정한다.
4. 웹 UI/API를 배포한다. 이 플래그가 없으면 새 API는 워커에 작업을 보내지 않고 안내 메시지를 반환한다.

구형 워커는 자동 저장 경로를 가지므로 웹만 먼저 배포한 뒤 준비 플래그를 켜면 안 된다.
`COST_TRACKING_ENABLED=false`와 DB 자격증명 제거를 적용한 로컬 실제 PDF 검증은 운영 데이터를 쓰지 않는다.
