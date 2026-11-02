# 기존 네 교재 작업: 복구 경로와 한정 예산 설정

2026-11-01 사용자가 기존 작업의 새 경로 연결과 이번 복구의 누적 총액 상한을 승인했다. 자동 재개·유료 호출은 승인하지 않았다.

- 운영 묶음: `052b8862-8799-4368-b096-12dc664f19c3`
- 승인 식별자: `bd324b2e-d18d-40c4-a71a-a2b2a145b317`
- 접수 식별자: `c60b21ab-2353-4271-8376-595e7ecfc8a3`
- 영독 상 / 하 / 수완 유형 / 실전 누적 파일 상한: $14 / $9 / $12 / $14.
- 묶음 누적 상한: $49. 기사용 $30.134968 포함, 추가 예산 여유 $18.865032.
- 네 작업 payload에 `bookProfile=jugis-two-column-v1`, 동일 `bundleId`만 추가했다. 원래 payload는 묶음의 비공개 recovery_authorization에 보존했다.
- 파일 단계는 pilot이며 preflight는 아직 실행하지 않았다. 묶음 manual_resume_required와 파일 legacy_review_required 유지.
- 네 작업 모두 failed, resume_after/lease_token NULL, 기존 attempt·결과·중지 시각 유지. 다음 명시적 재개 전까지 처리하지 않는다.
- 신규 접수 기본값 파일 $5, 일반 묶음 최대 $20 유지.
- 스키마 migration은 개발·운영 모두 적용. 기존 네 작업의 데이터 연결은 운영에만 적용.
- 운영 데이터 변경은 단일 repeatable-read 트랜잭션에서 전후 보호 해시가 같은지 검사한 후 커밋했다. 원본/문항/검증/체크포인트/비용 데이터는 변경하지 않았다.
- 체크포인트 3,709개. 전후 MD5: 553082c64affbd2f8166afd79e37a012; 문항 726f62b4ee5e48da799f4ad399ec645e; 비용 7da056d1152d6a6f4c869fe330910ce2; 문서 773ddf5418d1b47300d8580307f757ae.
- Cloud Run job generation 23 / executionCount 58 / PDF_IMPORT_CACHE_ONLY=true / ANTHROPIC_API_KEY 없음. Cloud Tasks queue PAUSED 확인.
- npm run check: 종료 코드 0, 205개 파일·1,751개 테스트 통과, 린트 오류 0 / 기존 경고 21개. 별도 SQL 테스트는 migration 재적용, 기본 예산 보존, 승인 범위·불변 연결·권한·유료 응답 보존 5건을 검증한다.
- 커밋·푸시·배포 및 모델 교체는 이번 요청에 포함되지 않아 실행하지 않았다. 현재 배포된 경로와 호환되는 SQL/작업 설정 변경이다.

## 모델 조사: 실제 모델 호출 없이 공식 문서 비교

현재 교재 매핑·원본 대조·풀이/어휘는 모두 claude-sonnet-5-5. 단순 모델명 치환 외에 모델 카탈로그, 단계별 라우팅, DB 비용 정산/예약 및 검증 provenance의 모델 기록도 맞춰야 한다.

Batch USD / 1M 입력 / 1M 출력:
- Sonnet 5.5: $1 / $5.
- Haiku 5.5: 입력 <=100k 요청 $0.05 / $0.25; 입력 >100k 요청 $0.25 / $1.25. 이미지·Batch 지원. 기존 Anthropic 전송 계층을 재사용할 수 있어 우선 후보다.
- GPT-6 Luna: 짧은 문맥 기준 $0.05 / $0.25. 이미지·구조화 출력·Batch 지원. OpenAI 전송/폴링/정산 어댑터를 추가해야 한다.
- Gemini 3.5 Flash-Lite: $0.15 / $1.25. Google 전송/폴링/정산 어댑터 필요.
- Gemini 3.8 Flash: 2026-12-31까지 $0.375 / $1.875, 이후 $0.75 / $3.75.

추천 비교안은 매핑·풀이/어휘만 Haiku 5.5, 최종 원본 대조/복구는 Sonnet 유지다. 기존 네 PDF의 정확도를 동등하다고 입증한 결과는 없으며 모델 교체를 실행하지 않았다. 대표 샘플에서 원문 누락·정답/해설 연결·공유 지문·스키마 실패와 유료 재시도율을 확인해야 한다.

기존 오프라인 잔여 요청 견적에 동일 토큰/성공률과 짧은 문맥의 0.05 가격비율을 대입한 가정:
- Sonnet 유지 추가 $9.34–16.37.
- 매핑·보완만 Haiku: 추가 약 $6.75–12.42 (약 24–28% 감소).
- 원본 대조/기존 복구가 현재 잔여 견적의 약 71–75%라서 일부 단계 교체만으로 전체 95% 절감은 아니다.
- 위 수치는 캐시 구성·모델별 추론량·응답 길이·실패율 변화가 반영되지 않은 민감도 계산이다. 실측/보장 견적이 아니며 기사용액과 클라우드 비용을 제외한다.
- 근거 계산: `tmp/pdfs/model-price-scenarios-20261101.json`.
- 운영 적용 DML/전후 근거: `tmp/pdfs/apply-scoped-recovery-20261101.sql` 및 DB 비공개 승인 기록. 재실행은 중복 연결 사전 조건에서 차단된다.

공식 출처:
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/models/haiku-5-5/overview
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://ai.google.dev/gemini-api/docs/pricing
