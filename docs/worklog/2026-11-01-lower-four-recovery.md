# 영독(하) 보류 4문항 수동 복구

유료 AI 호출과 PDF 재업로드 없이 원본 PDF·기존 추출 후보·원본 HWP 텍스트를 대조했다. 원본 SHA256은 `9b26fe9e76ff0569fc3968fac2984ab3ed8e3afb7a89b22e246533cea9c2a436`이다.

- Mini Test 2회 8번: 박물관 도표를 원본 픽셀에서 잘라 기존 비공개 이미지 저장소에 보존했다. 모든 수치와 다섯 진술을 대조해 정답 ④를 확인했다.
- Mini Test 3회 8번: 국가별 표를 같은 방식으로 보존했다. 7개국×3개 연도 수치와 진술을 대조해 정답 ③을 확인했다.
- Mini Test 3회 13번: 원본의 네 번째 밑줄 번호가 ③으로 중복된 오탈자를 ④로 교정했다. 다섯 밑줄 단어와 본문·인쇄 정답 ②는 유지했다. 교정 사실을 표시되는 해설과 raw_text의 검증 기록에 남겼다.
- Mini Test 3회 20번: 원본 PDF와 HWP 모두 (B) 표시가 실제로 존재한다. 앞선 누락 판정은 잘못됐으며, 원본의 (A)/(B)/(C)와 다섯 선택지를 보존했다. 원문 해설 및 문단 연결을 대조해 정답 ④를 확인했다.

검증된 4문항만 운영 문제은행 `f5c4b658-42f6-42ca-9fd6-1699fa3a03f6`에 단일 트랜잭션으로 저장했다. 총 120문항·고유 source_key 120개이며 새 문항 번호는 117~120이다. 재조회한 4문항의 16개 항목은 검증본과 모두 일치한다. 두 도표는 업로드 후 다운로드 SHA256이 로컬 원본 크롭과 일치한다. PDF 원본은 업로드하지 않았다.

기존 처리 작업 `4824d57b-34df-4edd-9d72-6296d8c5344d`의 failed 상태·attempt 6·completed_calls 522·중지 시각은 변경하지 않았다. 문서 및 자동 검증 기록을 완료/통과로 위장하지 않았다. DB 스키마 및 제품 코드는 변경하지 않았다.

근거 파일: `tmp/pdfs/four-reviewed-for-save.json`, `four-validation-report.json`, `four-stored-chart-assets.json`, `four-save-payload.json`, `four-save.sql`, `four-readback-proof.json`, `four-recovery-report.json`.

최종 `npm run check -- --maxWorkers=2` 종료 코드 0. 타입 검사 및 린트 오류 0, 204개 테스트 파일·1,746개 테스트 통과. 4문항의 별도 오프라인 원본 검증도 오류 0이며 영어·해석 커버리지는 모두 1이다.
