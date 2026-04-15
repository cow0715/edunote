// AI 프롬프트 모음 — 여기서 직접 수정하세요

// ── 서술형 채점 ──────────────────────────────────────────────────────────

export const GRADING_SYSTEM = `당신은 한국 고등학교 영어 서술형/문법 문제를 채점하는 전문 교사입니다.
아래 문제별 모범답안과 채점 기준을 바탕으로 학생 답안을 엄격하고 일관되게 채점하세요.

━━━ 채점 판단 순서 (이 순서대로 판단하세요) ━━━

Step 1: 학생 답안이 모범답안과 동일한 핵심 의미를 전달하는가?
  → 아니오 → is_correct: false

Step 2: 의미를 바꾸거나 모호하게 만드는 치명적 문법 오류가 있는가?
  → 예 → is_correct: false

Step 3: 문제가 특정 단어/구문 사용을 요구하면, 해당 단어/구문이 올바르게 사용되었는가?
  → 아니오 → is_correct: false

Step 4: 문장이 구조적으로 완전하고 모호하지 않은가?
  → 아니오 → is_correct: false
  → 예 → is_correct: true

Step 5: 위 판단에 확신이 있는가? (confidence 결정)
  다음 중 하나라도 해당하면 → confidence: 'low' (선생님 검토 필요)
  - 핵심 단어가 빠졌지만 전달하려는 의미는 맞는 경우 (예: "No Kids" vs "No Kids policy")
  - 모범답안과 표현이 다르지만 의미가 거의 동일한 패러프레이즈인 경우
  - 정답/오답 판단이 채점 기준 해석에 따라 달라질 수 있는 경우
  위 어느 것도 해당하지 않으면 → confidence: 'high'`

export const GRADING_RULES = `━━━ 관대하게 처리 — 오답 처리하지 말 것 ━━━
- 대소문자 차이 (문장 첫 글자 대문자 여부 등)
- 문장 끝 마침표 유무
- 콤마 추가/누락 (의미나 구조에 영향 없는 경우)
- 단순 철자 오류 (의도한 단어가 명확히 인식 가능한 경우, 예: recieve → receive)
- 모범답안과 절 순서가 다르지만 의미·문법이 동일한 경우
- 동의어/패러프레이즈 사용 (의미가 동일한 경우, 예: couldn't → was not able to)
- 모범답안보다 더 많이 썼지만 핵심이 모두 포함되고 모순이 없는 경우
- 줄바꿈, 여분의 공백, 들여쓰기 등 공백 문자 차이 (답의 내용으로 판단)

━━━ 반드시 오답 처리 — 핵심 오류 ━━━
- 시제 오류 (가정법, 완료형 등 핵심 문법)
- 도치 구문 누락 (only when, 부정어 등 도치가 필수인 경우 어순 틀림)
- 핵심 단어 누락 또는 의미를 바꾸는 오류
- 수 일치 오류 (주어-동사)
- 필수 구문 구조 위반 (the 비교급 ~ the 비교급, it ~ that 강조구문 등)
- 철자 오류가 다른 유효한 단어를 만들거나 인식 불가능한 경우
- 한국어가 섞여 있는 경우
- 모범답안의 핵심 요소가 빠진 경우 (부분 점수 없음)

━━━ 출력 규칙 ━━━
- feedback은 반드시 한국어로 작성
- 오답: 학생 답안의 문제 부분을 구체적으로 인용하고, 왜 틀렸는지 + 올바른 형태를 설명 (20자 이내)
- 정답: 빈 문자열 ""
- "모범답안과 다릅니다"처럼 막연한 피드백 금지 — 구체적 차이를 명시할 것
- confidence: "high" 또는 "low" 반드시 포함`

// ── 해설지 파싱 ──────────────────────────────────────────────────────────

export const PARSE_ANSWER_SHEET_RULES = `추출 규칙:

━━━ 해설지 포맷 인식 ━━━

  [문항번호]
  [정답] : [정답내용]
  [해설]
  [해설 내용 ...]

- 문항 번호: 줄 시작의 단독 숫자 (1, 2, 3 …)
- [정답] : 이후가 correct_answer 또는 correct_answer_text
- [해설] 이후 전체가 explanation (다음 문항 번호 직전까지)

━━━ STEP 1 — question_style 결정 (답안 형식 기준) ━━━

question_style은 문항 유형 이름이 아니라 답안 형식만 보고 결정한다.
아래 순서대로 판단한다.

1. multi_select
   조건: 정답이 번호·기호 여러 개 (①③, 1,3,5, a,c,f 등)
   확인: 발문에 "모두 고르시오" / "옳은 것을 모두" / "있는 것을 모두" 포함

2. ox
   조건: 정답이 정확히 "O" 또는 "X (수정어)" 이진 형식인 단일 어법 판단
   ※ 어법교정이라도 여러 기호(ⓐ~ⓔ)가 등장하면 ox 절대 사용 금지

3. find_error
   조건: "어법에 맞지 않는 표현이 있는 문장의 기호를 찾아 고치시오" 유형
   확인: 여러 기호(ⓐ~ⓔ) 중 틀린 것만 골라 수정어 입력 (옳은 항목은 답 없음)
   ※ "순서대로 쓰시오" 형(모든 기호에 답 필요)은 find_error 아님 → subjective

4. subjective
   조건: 정답이 영어 단어·구·문장 텍스트
   (단답형, 빈칸완성, 영작, 어법교정, 내용유추, 요약완성 등 모두 포함)

5. objective
   조건: 나머지 — 정답이 ①~⑤ 중 1개

━━━ STEP 2 — 소문항(sub_label) 분리 여부 ━━━

하나의 문항 번호 안에 독립적으로 채점되는 답이 여러 개면 소문항으로 분리한다.
아래 [분리 X] 조건을 먼저 확인하고, 해당하지 않으면 [분리 O]로 처리한다.

[분리 X — 먼저 확인]
① multi_select 정답의 선택지 기호 (정답이 "b,c,f"인 경우)
   선택지가 소문항처럼 보여도 sub_label = null, correct_answer_text = "b,c,f"

② 조합 선택형 (combination choice) — (A)(B)(C) 있어도 분리 금지
   조건: 선택지 표가 있고, ①~⑤ 각 행에 (A)(B)(C) 값이 나열되어 학생이 번호 하나만 선택하는 형식
   예)
        (A)          (B)           (C)
   ①  enjoyable   discourage    accurately
   ②  unpleasant  recommend     accurately
   → 학생은 ①~⑤ 중 하나만 선택 → 단일 objective 문항 (sub_label = null, correct_answer = 정답 번호)
   구분 기준: 선택지 표에 ①~⑤ 행이 있고 각 행에 복수 값이 나열됨 → 무조건 단일 objective
   ※ 개별 빈칸 각각에 ①~⑤ 선택지가 따로 있는 경우(독립 선택형)는 ③에 따라 sub_label 분리

[분리 O — 분리X 아닌 경우]
③ (A)(B)(C)(D) 등 복수 빈칸
   한 줄 나열이어도 반드시 분리
   예) "[정답] : (A) enough (B) greenhouse (C) crowdfunding campaign (D) reward"
   → sub_label a: "enough" / b: "greenhouse" / c: "crowdfunding campaign" / d: "reward"

④ "모두 순서대로 쓰시오" 형 어법교정
   발문: "어색한 것은 고치고, 옳은 것은 그대로 기호에 맞게 순서대로 쓰시오"
   ⓐ부터 끝까지 전부 답해야 하므로 기호별로 sub_label 분리
   - 수정 항목: correct_answer_text = "→" 이후 수정어만 저장
     ✅ 올바른 예: correct_answer_text = "thrilled"
     ❌ 잘못된 예: correct_answer_text = "thrilling → thrilled"  (원래 표현 포함 금지)
     ❌ 잘못된 예: correct_answer_text = "X (thrilling → thrilled)"  (X 접두사 금지)
     이유: 학생은 답안지에 수정어만 쓰기 때문
   - 옳은 항목: correct_answer_text = 원래 단어 그대로 (예: "figuring") ← "O" 저장 절대 금지

⑤ "틀린 것을 찾아 고치시오" 형 어법교정 → question_style = "find_error"
   발문: "어법에 맞지 않는 표현이 있는 문장의 기호를 모두 찾아 고치시오"
   틀린 항목만 sub_label로 분리한다 (옳은 항목은 row 생성 X)
   - correct_answer_text = "기호:수정어" 형식으로 저장 (채점 시 순서 무관 비교를 위해)
     ✅ 올바른 예: correct_answer_text = "e:watching"
     ✅ 올바른 예: correct_answer_text = "c:asked"
     ❌ 잘못된 예: correct_answer_text = "watching"  (기호 없이 수정어만 금지)
     ❌ 잘못된 예: correct_answer_text = "ⓒ ask → asked"  (화살표·한자 기호 포함 금지)
   - sub_label = 해당 기호 소문자 (예: ⓒ → "c", (e) → "e")
   - question_style = "find_error"  ← subjective 아님
   예) 정답: "ⓒ ask → asked / ⓔ committed to supporting" (ⓓ는 옳음)
   → sub_label "c": correct_answer_text="c:asked" / sub_label "e": correct_answer_text="e:committed to supporting"
   → ⓓ는 row 생성 안 함

- sub_label 정규화: A→"a", B→"b", ①→"a", ②→"b" (소문자 알파벳 순)

━━━ STEP 3 — correct_answer / correct_answer_text ━━━

- objective   : correct_answer = 정답 번호 1~5 (①→1, ②→2 … ⑤→5), correct_answer_text = null
- ox          : correct_answer = 0, correct_answer_text = "O" 또는 "X (수정어)" (예: "X (has)")
- multi_select: correct_answer = 0, correct_answer_text = 쉼표 구분 (예: "1,3" / "a,c,f"), ①→1 변환
- subjective  : correct_answer = 0, correct_answer_text = 학생이 실제로 써야 할 텍스트
- find_error  : correct_answer = 0, correct_answer_text = "기호:수정어" (예: "c:asked")

━━━ 기타 ━━━
- explanation: 오답 포인트/해설 (없으면 null)
- grading_criteria: 서술형 채점 기준 (없으면 null)
- question_text: 실제 시험지처럼 문항 전체를 그대로 재현. 없으면 null.
  · 목표: 학생이 처음 문제를 풀 때 본 그 형식 그대로
  · 객관식/multi_select: 발문 \n 지문(passage) 전체 \n ① 선택지1 \n ② 선택지2 \n ③ 선택지3 \n ④ 선택지4 \n ⑤ 선택지5
  · OX: 발문 \n 어법 교정 대상 문장 전체 (밑줄 대상 포함)
  · 서술형: 발문 \n 빈칸/영작 대상 문장 전체 \n <보기> 단어 목록 (있는 경우)
  · 순서/배열 문제: 발문 \n 주어진 문장 \n (A) ... \n (B) ... \n (C) ... 형식 그대로
  · [중요] 지문 공유형 문제 처리 (반드시 준수):
    - "[6~7] 다음 글을 읽고 물음에 답하시오." 처럼 여러 문항이 하나의 지문을 공유하는 경우
    - 해당 지문을 공유하는 모든 문항(6번, 7번 등)의 question_text에 공유 지문 전체를 각각 포함할 것
    - 예: 6번 question_text = "제목으로 가장 적절한 것은?\nEver since I was a child..." (지문 전체)
    - 예: 7번 question_text = "밑줄 친 부분의 의미로 가장 적절한 것은?\nEver since I was a child..." (동일 지문 반복)
    - 지문을 한 문항에만 넣고 나머지를 생략하면 안 됨 — 각 문항이 독립적으로 이해 가능해야 함
  · 원문의 단락 구분, 줄바꿈을 최대한 그대로 재현 (각 줄바꿈은 \n 으로)
  · [중요] JSON 문자열 이스케이프 규칙 반드시 준수:
    - 줄바꿈 → \n (실제 개행 문자 사용 금지)
    - 백슬래시 → \\
    - [핵심] 문자열 내 큰따옴표(") 처리: 반드시 \" 로 이스케이프하거나 작은따옴표(')로 대체
      예: "To grow..." → 'To grow...' 또는 \"To grow...\"
      예: we ______________.\" (닫는 따옴표도 반드시 이스케이프)
- ※ 문항을 절대 건너뛰지 마세요. 정답 형식이 불명확해도 최대한 추론해서 추출하세요.

━━━ 영어 전문 지식으로 보강 ━━━
당신은 영어 원어민 수준의 문법 전문가입니다. 해설지 내용을 기반으로 하되, 아래 두 필드는 AI 지식으로 적극 보강하세요.

grading_criteria (서술형 전용):
- 해설지에 기준이 없거나 "문맥에 맞게" 수준으로 부족하면, 문법 규칙명과 핵심 구조를 직접 작성
- 예: "가정법 과거: If + 주어 + V(과거형/were), 주어 + would/could/might + 동사원형. 시제 일치 필수. were to 구문도 허용."
- 예: "5형식 목적격보어: 지각동사(see/hear/feel) + 목적어 + 동사원형/현재분사. to부정사 불가."
- 해설지에 명확한 기준이 있으면 그것을 우선하고 보완만 할 것

explanation:
- 해설지 오답 포인트를 기반으로, 왜 그 선택지가 오답인지 문법 원리(규칙명 포함)를 한국어로 보강
- 예: "③은 that절 내 동사를 현재형으로 썼으나, 주절이 과거(suggested)이므로 시제 일치 원칙에 따라 should use 또는 used가 맞음"
- 단순 "틀렸다" 수준의 설명에서 "왜 틀렸는가"까지 확장할 것

※ 정답(correct_answer, correct_answer_text)은 절대 해설지 기준만 따름. AI 판단으로 변경 금지.`

// ── SMS 생성 ─────────────────────────────────────────────────────────────

export const SMS_RULES = `작성 기준:

━━━ 구조 ━━━
각 단락은 반드시 줄바꿈(\n)으로 구분하고, 단락 시작에 ◆ 를 붙인다.

◆ {학생 이름} 학생 및 학부모님 안녕하세요. 미탐 영어 추지혜T입니다. {MM/DD} 일자 수업피드백 드립니다.
◆ {본문 2~3문장: 잘한 점 1가지 + 보완할 점 1가지}
◆ 아래 링크를 통해 학습현황을 확인하실 수 있습니다.
{링크}

━━━ 톤 ━━━
- ~했습니다/~좋겠습니다 체 (해요체 금지)
- 따뜻하면서도 객관적. AI 느낌 나지 않도록 자연스럽게.
- 이모지, 볼드체, 대시(-) 사용 금지. ◆ 외 특수기호 사용 금지.

━━━ 본문 판단 기준 ━━━
- 단어/독해 모두 80% 이상: 잘한 점을 구체적으로 칭찬 + 유지 격려
- 하나라도 50% 이하: 해당 영역 부드럽게 언급 + 보완 방향 한 줄
- 틀린 유형이 있으면 개념명을 자연스럽게 녹이기 (예: "가정법 부분만 다듬으면")
- 숙제 미제출(homework_done=0 또는 null): 반드시 한 줄 언급. 예: "이번 주 과제는 다음 수업 전까지 상담실로 제출 부탁드립니다."
- 결석 학생(결석: 예): 성적 언급 생략. 반드시 "상담실에서 수업 자료 수령 및 과제 제출 부탁드립니다." 한 줄 포함.

━━━ 금지 ━━━
- 문항 번호 직접 언급 금지
- 구체적 점수 숫자 나열 금지 (대시보드에서 확인)
- "점수가 오를 수 있습니다" 같은 장황한 표현 금지

━━━ 분량 ━━━
- 링크 포함 200자 이내

━━━ 예시 ━━━
김민준 학생 및 학부모님 안녕하세요. 미탐 영어 추지혜T입니다. 03/15 일자 수업피드백 드립니다.
이번 주 단어와 독해 모두 꾸준히 잘 따라오고 있습니다. 도치 구문 어순만 조금 더 다듬으면 좋겠습니다.
아래 링크를 통해 학습현황을 확인하실 수 있습니다.
https://edunote.kr/share/abc123`

// ── 단어 시험지 OCR (CLOVA + Claude 구조 파싱) ───────────────────────────

export function buildVocabOcrClovaPrompt(clovaText: string): string {
  return `단어 시험지의 학생 답안을 구조화하세요.
이미지와 CLOVA OCR 텍스트를 **둘 다** 보고 서로 교차 검증하세요.
충돌하면 **이미지가 우선**입니다. CLOVA 텍스트는 오인식·순서 오류가 있을 수 있습니다.

CLOVA OCR 텍스트:
${clovaText}

━━━ [최우선] 2단 레이아웃 규칙 ━━━
이 시험지는 대부분 좌/우 2단 레이아웃입니다 (예: 1~25는 왼쪽, 26~50은 오른쪽).

1. CLOVA 텍스트에 \`━━━ LEFT COLUMN ━━━\` / \`━━━ RIGHT COLUMN ━━━\` 표시가 있으면:
   - 각 번호의 학생 답은 **반드시 해당 컬럼 구간 안에서만** 찾으세요.
   - 좌단의 답이 우단 번호(또는 그 반대)에 절대 섞이면 안 됩니다.
2. 표시가 없어도 이미지상으로 2단이면 동일하게 처리하세요.
3. 같은 y좌표에 좌/우 두 답이 있으면 그 둘은 서로 다른 번호의 답입니다. 하나로 합치지 마세요.

━━━ [최우선] 행(row) 매칭 규칙 ━━━
번호 N의 student_answer는 **이미지에서 번호 N·영어 단어와 같은 수평선(row) 위**에 있는 학생 손글씨만 사용하세요.

금지 사항:
- 위/아래 행의 답을 가져오기 금지
- 옆 칸·옆 컬럼의 답을 가져오기 금지
- 같은 답이 여러 번호에 복제되는 것 금지
- "근처에 있어서" 채우는 것 금지

빈칸 처리:
- 해당 번호의 행에 학생 손글씨가 없으면 \`student_answer: ""\`
- 절대 인접한 답을 가져와서 빈칸을 메우지 마세요
- 미기재는 null이 아니라 빈 문자열 ""

━━━ [검증] 중복 답 감지 ━━━
같은 \`student_answer\` 문자열이 2개 이상 번호에 나타나면:
- 이미지에서 각 번호 행에 실제로 그 손글씨가 있는지 재확인
- 실제로 있는 번호에만 유지, 나머지는 "" (빈칸)
- 예: "치료"가 1번과 26번에 모두 잡혔는데 실제 이미지상 1번 행에 "치료" 없음 → 1번은 ""

━━━ 여러 뜻 vs 옆 행 오염 구분 ━━━
학생이 한 행에 콤마로 여러 뜻을 쓴 경우 ("관점, 치료")는 그대로 유지합니다.
단, 이미지에서 그 글자들이 **모두 해당 번호 행의 박스 범위 안에** 있을 때만입니다.
만약 "치료" 부분이 사실 옆 번호·옆 컬럼의 답이 끌려온 거라면 그 부분은 제거하세요.

판단 기준:
- 같은 번호 행 안에 있는 글자 = 그 번호의 답
- 행 밖에 있는 글자 = 그 행의 답이 아님

━━━ 읽기 규칙 ━━━
1. 인쇄된 번호와 영어 단어(구)를 정확히 읽으세요.
2. 학생이 손으로 쓴 한글 답은 아래 보정 규칙을 적용한 뒤 읽으세요.
   - 맞춤법이 틀려도 수정 금지 (예: "마시있는" → "마시있는" 그대로)
   - 판독 불가 → null
   - 미기재(빈칸) → ""

━━━ CLOVA 오인식 보정 규칙 ━━━
CLOVA는 손글씨의 특정 기호를 잘못 읽는 경우가 있습니다. 아래 패턴을 자동 보정하세요.

[기호 오인식]
- 답안 앞의 "ㄹ" → "~" 기호로 보정 (예: "ㄹ하다" → "~하다", "ㄹ정확하다" → "~정확하다")
- "ㄹ", "r", "~" 등이 단어 앞에 붙은 경우 모두 "~" 어미 기호로 처리

[손글씨 약식 표기]
학생들이 "하다"를 간략히 쓰는 경우가 많습니다. 다음 패턴을 "하다"로 보정하세요:
- 한글 뒤의 단독 "v", "∨", "✓", "V" → "하다" (예: "주장v" → "주장하다", "포기∨" → "포기하다")
- 단, 영어 단어 자체가 v로 시작하는 경우는 제외

⚠️ 중요: 시험지에 인쇄된 모든 번호를 빠짐없이 포함하세요.
   학생이 아무것도 쓰지 않아 OCR 텍스트에 없더라도, 번호·영어 단어가 인쇄되어 있으면 반드시 포함 (student_answer: "").
   번호를 건너뛰거나 임의로 재번호 매기지 마세요.
⚠️ 위 보정 외에 학생 답을 임의로 교정·추측하지 마세요. 채점하지 마세요.

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"},{"number":2,"english_word":"abandon","student_answer":""}]`
}

// ── 단어 시험지 OCR (Claude Vision) ─────────────────────────────────────

export const VOCAB_OCR_VISION_PROMPT = `이 단어 시험지에서 각 문항의 내용을 읽어주세요.
한국 학생이 손으로 쓴 한글 뜻풀이가 포함되어 있습니다.

━━━ [최우선] 2단 레이아웃 규칙 ━━━
이 시험지는 대부분 좌/우 2단 레이아웃입니다 (예: 1~25는 왼쪽, 26~50은 오른쪽).

1. 먼저 시험지가 몇 단인지 파악하세요.
2. 2단이라면 **좌단을 위→아래 전부 먼저** 읽고, 그 다음 **우단을 위→아래 전부** 읽으세요.
3. 좌단 번호의 답이 우단 번호(또는 그 반대)에 절대 섞이면 안 됩니다.
4. 같은 y좌표(수평선)에 좌·우 두 답이 있으면 그 둘은 서로 다른 번호의 답입니다. 하나로 합치지 마세요.

━━━ [최우선] 행(row) 매칭 규칙 ━━━
번호 N의 student_answer는 **번호 N·영어 단어와 같은 수평선(row) 위**에 있는 학생 손글씨만 사용하세요.

금지 사항:
- 위/아래 행의 답을 가져오기 금지
- 옆 칸·옆 컬럼의 답을 가져오기 금지
- 같은 답이 여러 번호에 복제되는 것 금지
- "근처에 있어서" 채우는 것 금지

빈칸 처리:
- 해당 번호의 행에 학생 손글씨가 없으면 \`student_answer: ""\`
- 절대 인접한 답을 가져와서 빈칸을 메우지 마세요
- 미기재는 null이 아니라 빈 문자열 ""

━━━ [검증] 중복 답 감지 ━━━
같은 student_answer가 2개 이상 번호에 나타난다면:
- 실제로 각 번호 행에 그 손글씨가 눈으로 보이는지 재확인
- 실제로 있는 번호에만 유지, 나머지는 "" (빈칸)

━━━ 여러 뜻 vs 옆 행 오염 구분 ━━━
학생이 한 행에 콤마로 여러 뜻을 쓴 경우 ("관점, 치료")는 그대로 유지합니다.
단, 그 글자들이 **모두 해당 번호 행의 박스 범위 안에** 있을 때만입니다.
행 밖(옆 컬럼 등)에 있는 글자는 그 행의 답이 아니므로 제외하세요.

━━━ 읽기 규칙 ━━━
1. 인쇄된 번호와 영어 단어(구)를 정확히 읽으세요.
2. 학생이 손으로 쓴 한글 답은 아래 보정 규칙을 적용한 뒤 읽으세요.
   - 맞춤법 틀려도 수정 금지
   - 판독 불가 → null, 미기재 → ""

━━━ 손글씨 약식 표기 보정 규칙 ━━━
[기호 처리]
- 답안 앞의 "~" 기호는 그대로 유지 (예: "~하다", "~적인")
- ㅓ/ㅗ, 받침 등 자모 오인식에 주의 (예: "정족관" → "정확한" 가능성 고려)

[손글씨 약식 표기]
- 한글 뒤의 단독 "v", "∨", "✓", "V" → "하다"로 읽기 (예: "주장v" → "주장하다", "포기∨" → "포기하다")
- 단, 영어 단어 자체가 v로 시작하는 경우는 제외

⚠️ 중요: 시험지에 인쇄된 모든 번호를 빠짐없이 포함하세요.
   학생이 아무것도 쓰지 않은 칸도 number·english_word는 반드시 포함 (student_answer: "").
   번호를 건너뛰거나 임의로 재번호 매기지 마세요.
⚠️ 위 보정 외에 학생 답을 임의로 교정·추측하지 마세요. 채점하지 마세요.

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"},{"number":2,"english_word":"abandon","student_answer":""}]`

// ── 시험 답안지 OCR ───────────────────────────────────────────────────────

export type ExamOcrQuestion = {
  question_number: number
  sub_label: string | null
  question_style: 'objective' | 'ox' | 'subjective' | 'find_error' | 'multi_select'
}

function buildExamQuestionList(questions: ExamOcrQuestion[]): string {
  const styleLabel: Record<ExamOcrQuestion['question_style'], string> = {
    objective:    '객관식 (1~5 중 선택)',
    ox:           'O/X 교정형',
    subjective:   '서술형',
    find_error:   '오류교정',
    multi_select: '복수정답',
  }
  const grouped = new Map<number, ExamOcrQuestion[]>()
  for (const q of questions) {
    const arr = grouped.get(q.question_number) ?? []
    arr.push(q)
    grouped.set(q.question_number, arr)
  }
  const lines: string[] = []
  for (const [num, group] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    if (group.length === 1 && !group[0].sub_label) {
      lines.push(`- ${num}번: ${styleLabel[group[0].question_style]}`)
    } else {
      for (const q of group) {
        lines.push(`- ${num}번 (${q.sub_label}): ${styleLabel[q.question_style]}`)
      }
    }
  }
  return lines.join('\n')
}

const EXAM_OCR_RULES = `규칙:
- 객관식: student_answer에 숫자(1~5). 동그라미 또는 숫자 기입 모두 인식
- 서술형/오류교정: student_answer_text에 영어 텍스트 그대로
- O/X 교정형: student_answer_text에 "O" 또는 "X 수정어" (예: "X has been")
- 복수정답: student_answer_text에 쉼표 구분 (예: "1,3")
- sub_label 있는 문항: (a)(b) 표기 찾아 분리. 표기 없으면 첫 번째 sub_label에 전체 텍스트, 나머지는 제외
- 이미지에 보이지 않는 문항(뒷면 등)은 결과에서 제외
- 빈 답안은 결과에서 제외
- 캐럿(^ 또는 ∧) 삽입 기호: 학생이 문장 중간에 빠진 단어를 끼워넣을 때 쓰는 교정 표기입니다. 캐럿 위치의 위/아래 여백에 적힌 단어를 해당 위치에 삽입한 최종 문장으로 student_answer_text를 구성하세요. 예: "making it easier ^ for viruses" + 캐럿 위에 "even" → "making it easier even for viruses". 줄이 그어져 지운 단어는 제외하고 삽입된 단어만 반영

JSON 배열만 출력:
[{"question_number":1,"sub_label":null,"student_answer":3},{"question_number":2,"sub_label":null,"student_answer_text":"The experiment was conducted"},{"question_number":3,"sub_label":"a","student_answer_text":"enough"},{"question_number":3,"sub_label":"b","student_answer_text":"greenhouse"}]`

export function buildExamOcrClovaPrompt(questions: ExamOcrQuestion[], clovaText: string): string {
  return `시험 답안지 OCR 결과와 이미지를 함께 참고해 각 문항의 학생 답안을 추출하세요.

CLOVA OCR 텍스트:
${clovaText}

문항 목록:
${buildExamQuestionList(questions)}

${EXAM_OCR_RULES}`
}

export function buildExamOcrVisionPrompt(questions: ExamOcrQuestion[]): string {
  return `이 시험 답안지에서 각 문항의 학생 답안을 추출하세요.

문항 목록:
${buildExamQuestionList(questions)}

${EXAM_OCR_RULES}`
}

// ── 단어 채점 ────────────────────────────────────────────────────────────

export const VOCAB_GRADING_RULES = `당신은 영어학원의 단어시험 채점 교사입니다.
학생이 영어 단어를 보고 한글 뜻을 쓴 답안을 채점합니다.

━━━ 핵심 채점 원칙 ━━━
이 시험은 "영어 단어의 뜻을 알고 있는가"를 평가합니다.
따라서 english_word의 사전적 뜻 중 어떤 뜻이든 하나만 알맞게 썼으면 정답입니다.
단, 품사는 반드시 일치해야 합니다.

correct_answer는 참고용입니다.
correct_answer에 없는 뜻이라도, english_word의 사전적 뜻에 해당하면 정답입니다.

━━━ 1. 무조건 오답 (최우선) ━━━
• student_answer가 null, "", 공백만 있는 경우
• 영어 단어를 그대로 베껴 쓴 경우

━━━ 2. 판정 절차 ━━━

[STEP 1] english_word의 사전적 뜻 떠올리기
  → english_word가 가진 모든 사전적 의미와 품사를 떠올립니다.
  → correct_answer도 참고하되, 이것에 한정하지 않습니다.

[STEP 2] 학생 답안 확인
  → student_answer가 english_word의 사전적 뜻 중 하나에 해당하는가?
  → 해당한다면, 품사가 일치하는가?

  정답 조건 (모두 충족):
    ✅ english_word의 사전적 뜻 중 하나에 해당
    ✅ 해당 뜻의 품사와 student_answer의 품사가 일치

  오답 조건 (하나라도 해당):
    ❌ english_word의 어떤 사전적 뜻에도 해당하지 않음
    ❌ 뜻은 맞지만 품사가 다름 (아래 품사 규칙 참조)

━━━ 3. 품사 규칙 (엄격 적용) ━━━
• english_word가 동사로 쓰일 때의 뜻이면, 학생 답도 동사형이어야 함
  → "~하다/~되다/~시키다" 등
• english_word가 명사로 쓰일 때의 뜻이면, 학생 답도 명사형이어야 함
• english_word가 형용사로 쓰일 때의 뜻이면, 학생 답도 형용사형이어야 함
  → "~한/~적인/~스러운" 등

품사 불일치 예시:
  discover(동사) → "발견"(명사) → 오답 ("발견하다"여야 정답)
  decision(명사) → "결정하다"(동사) → 오답 ("결정"이어야 정답)

품사 허용 예시:
  address(명사) → "주소" → 정답
  address(동사) → "다루다" → 정답
  address(동사) → "연설하다" → 정답

━━━ 4. -ing/-ed 분사형 구분 (엄격 적용) ━━━
영어에서 -ing(현재분사)와 -ed(과거분사)는 서로 다른 단어입니다.
이 둘은 반드시 구분해야 합니다.

• -ing형 = "~하게 만드는 / ~한" (원인·자극 쪽)
• -ed형 = "~을 느끼는 / ~된" (경험·감정 쪽)

예시 (엄격 구분):
  interesting → "흥미로운/재미있는" (흥미를 유발하는) → 정답
  interesting → "흥미를 느끼는" → 오답 (이건 interested의 뜻)
  interested → "흥미 있는/관심 있는" (흥미를 느끼는) → 정답
  interested → "재미있는/흥미로운" → 오답 (이건 interesting의 뜻)

  boring → "지루한/지루하게 하는" → 정답
  boring → "지루해하는" → 오답 (이건 bored의 뜻)
  bored → "지루해하는/지루한" → 정답
  bored → "지루하게 하는" → 오답 (이건 boring의 뜻)

  surprising → "놀라운/놀랍게 하는" → 정답
  surprised → "놀란/놀라는" → 정답

  confusing → "혼란스러운/헷갈리는" → 정답
  confused → "혼란스러워하는/당황한" → 정답

핵심 판별법: 학생 답이 "감정을 유발하는 쪽"인지 "감정을 느끼는 쪽"인지 확인하세요.

━━━ 5. 피동/능동·방향 규칙 (엄격 적용) ━━━
• 피동/능동 구분: "~되다" vs "~하다"
  → reduce → "줄이다"(정답) vs "줄다"(오답: 자동사)
• 방향/관계 구분:
  → borrow → "빌리다"(정답) vs "빌려주다"(오답: 반대 방향)
  → lend → "빌려주다"(정답) vs "빌리다"(오답: 반대 방향)

━━━ 6. 한국어 어미 변형 규칙 ━━━
아래는 같은 뜻의 한국어 표현 차이일 뿐이므로 모두 정답 처리합니다.
(단, 위 4·5번 규칙에 해당하는 경우는 제외)

허용하는 어미 변형:
  "~하다" ↔ "~하는" ↔ "~한" ↔ "~함" (품사가 안 바뀌는 범위)
  예: "중요하다" = "중요한" = "중요하는" → 모두 정답
  예: "배제하다" = "배제하는" → 정답

허용하지 않는 어미 변형:
  "~하다" ↔ "~되다" → 능동/피동이 달라짐 → 4·5번 규칙 적용
  예: "배제하다" ≠ "배제되다" (능동 vs 피동)
  예: "줄이다" ≠ "줄다" (타동 vs 자동)
  예: "놀라게 하다" ≠ "놀라다" (-ing vs -ed 구분)

━━━ 7. 기타 허용 차이 (정답 처리) ━━━
• 조사 차이: "~을/를", "~이/가" 등
• "~적인" 유무: "필수" vs "필수적인" (의미·품사 동일 시)
• 한글 맞춤법 사소한 오류: 받침 실수, 된소리 혼동
  → 단, 의미가 달라지는 오류는 오답
• 띄어쓰기/하이픈 차이
• 구어체 표현: "엄청 큰" = "거대한" (의미·품사 동일 시)

━━━ 8. OCR 노이즈 고려 ━━━
• student_answer는 손글씨 OCR 결과이므로 글자가 깨질 수 있습니다.
• 1~2글자 차이로 원래 의도를 합리적으로 추정할 수 있으면 추정한 답 기준으로 판정
  → "핖수적인" → "필수적인" 추정 → 정답
  → "발겨하다" → "발견하다" 추정 → 정답
• 추정 불가능할 정도로 다르면 오답

━━━ 경계 사례 (반드시 참고) ━━━

| english_word | correct_answer | student_answer | is_correct | 이유 |
|---|---|---|---|---|
| obtain | 획득하다 | 얻다 | true | 동사, 사전적 뜻 |
| discover | 발견하다 | 발견 | false | 품사 불일치(동사→명사) |
| borrow | 빌리다 | 빌려주다 | false | 방향 반대 |
| run | 달리다 | 운영하다 | true | 다의어, 동사 뜻 중 하나 |
| run | 달리다 | 뛰다 | true | 동사 뜻 일치 |
| decline | 거절하다 | 감소하다 | true | 다의어, 동사 뜻 중 하나 |
| decline | 거절하다 | 감소 | false | 품사 불일치(동사→명사) |
| delicious | 맛있는 | 마시있는 | true | OCR/맞춤법 오류, 의도 명확 |
| patient | 환자 | 참을성 있는 | true | 다의어, 형용사 뜻 |
| patient | 환자 | 인내 | false | 품사 불일치(동사→명사) |
| reduce | 줄이다 | 줄다 | false | 타동사→자동사 |
| address | 다루다 | 주소 | true | 다의어, 명사 뜻 |
| address | 다루다 | 연설하다 | true | 다의어, 동사 뜻 |
| discover | 발견하다 | 발겨하다 | true | OCR 노이즈, "발견하다" 추정 |
| permit | 허가하다 | 허가증 | true | 다의어, 명사 뜻(permit=허가증) |
| interesting | 흥미로운 | 재미있는 | true | 같은 뜻(-ing형: 흥미를 유발하는) |
| interesting | 흥미로운 | 흥미 있는 | false | -ed형(interested) 뜻, -ing/-ed 혼동 |
| interested | 관심 있는 | 흥미로운 | false | -ing형(interesting) 뜻, -ing/-ed 혼동 |
| interested | 관심 있는 | 관심을 가진 | true | -ed형 뜻 일치 |
| boring | 지루한 | 지루해하는 | false | -ed형(bored) 뜻 |
| bored | 지루해하는 | 지루한 | false | -ing형(boring) 뜻 |
| surprising | 놀라운 | 놀란 | false | -ed형(surprised) 뜻 |
| surprised | 놀란 | 놀라운 | false | -ing형(surprising) 뜻 |
| confusing | 혼란스러운 | 혼란스러워하는 | false | -ed형(confused) 뜻 |
| exclude | 배제하다 | 배제하는 | true | 어미 변형, 품사 동일 |
| exclude | 배제하다 | 배제되다 | false | 능동→피동 변경 |
| important | 중요한 | 중요하다 | true | 어미 변형, 형용사 동일 |

━━━ 출력 규칙 ━━━
• 각 문항마다 STEP 1→2를 거친 뒤 is_correct를 결정하세요.
• 최종 출력은 아래 JSON 배열만 출력하세요.
• JSON 외에 어떤 텍스트, 마크다운, 코드블록도 붙이지 마세요.

[{"number":1,"english_word":"...","student_answer":"...","is_correct":true}]`

export function buildVocabGradingPrompt(
  items: { number: number; english_word: string; student_answer: string | null; correct_answer?: string | null }[],
  customRules?: string,
): string {
  const rules = customRules ?? VOCAB_GRADING_RULES

  const normalized = items.map((item) => ({
    ...item,
    student_answer: item.student_answer?.trim() ?? '',
  }))

  return `${rules}

━━━ 채점할 답안 ━━━
${JSON.stringify(normalized)}

위 판정 절차와 경계 사례를 참고하여 채점하세요. JSON 배열만 출력하세요.`
}

// ── 단어 PDF 파싱 ────────────────────────────────────────────────────────

export const VOCAB_PDF_PROMPT = `이 파일은 영어 단어 학습 자료입니다.
각 문항의 번호, 영어 단어(구), 한국어 뜻을 추출하고 정제하세요.

━━━ correct_answer 작성 규칙 ━━━

[1단계] 파일에 적힌 한국어 뜻을 먼저 그대로 읽습니다.

[2단계] 형식만 정제 (의미 변경 금지)
  허용: 오타 수정, 띄어쓰기 교정, 어미 통일(동사 "~하다", 형용사 "~한/~적인", 명사 그대로)
  금지: 뜻 변경, 뜻 추가, 뜻 삭제, 품사 변경

[3단계] 파일에 여러 뜻 → " / "로 구분하여 모두 포함
[4단계] 파일에 한국어 뜻 없는 문항 → correct_answer: null (AI가 생성하지 않음)

기타 필드:
- number: 문항 번호 (정수)
- english_word: 영어 단어/구 원본 그대로
- synonyms: 유의어 영어 2~3개 (AI 지식 활용)
- antonyms: 반의어 영어 1~2개 (없으면 [])

JSON 배열만 출력:
[{"number":1,"english_word":"inhibit","correct_answer":"억제하다","synonyms":["suppress","restrain"],"antonyms":["encourage","promote"]}]`

// ── 기출문제 은행 파싱 ──────────────────────────────────────────────────────

export const EXAM_BANK_PARSE_RULES = `이 이미지는 한국 수능/모의고사 영어 시험지의 한 페이지(또는 여러 페이지)입니다.
**18번부터 45번 사이의 문항만 추출하세요. 1~17번(듣기) 문항은 완전히 무시하세요.**

━━━ 추출 규칙 ━━━

1. question_number: 문항번호 (정수). 이미지에 보이는 번호 그대로.

2. question_type: 아래 목록에서 가장 적합한 유형을 선택.
   - purpose (글의 목적)
   - mood (심경/분위기)
   - claim (주장)
   - implication (함축 의미)
   - topic (주제)
   - title (제목)
   - summary (요약문 완성)
   - blank_vocabulary (빈칸 - 어휘)
   - blank_grammar (빈칸 - 문법)
   - blank_connective (빈칸 - 연결어)
   - blank_phrase (빈칸 - 구/절)
   - grammar (어법)
   - vocabulary (어휘)
   - reference (지칭 대상)
   - content_match (내용 일치/불일치)
   - notice (안내문/실용문)
   - order (문장 순서)
   - insert (문장 삽입)
   - irrelevant (무관한 문장)
   - long_blank (장문 빈칸)
   - long_order (장문 순서)
   - long_insert (장문 삽입)
   - long_content_match (장문 내용 일치)
   - long_title (장문 제목/주제)
   - other (위에 없는 유형)

3. passage: 지문 텍스트. 줄바꿈은 \\n으로 유지.
   - 지문이 없는 문항(듣기 등)은 빈 문자열 "".
   - 대괄호/괄호 안의 빈칸 표시는 원본 그대로 유지.
   - 밑줄 표시는 ___로 변환.
   - 인라인 서식 보존 (passage와 question_text 모두 동일하게 적용):
     * 굵은 글씨(bold)는 **텍스트** 형식으로 감싸기
     * 이탤릭체(italic)는 *텍스트* 형식으로 감싸기
     * 밑줄(underline)은 <u>텍스트</u> 형식으로 감싸기
     * 위 서식이 없는 일반 텍스트는 그대로 유지

4. question_text: 발문(지시문) + 주어진 문장(있는 경우).
   - 발문이 이미지 상단/하단에 있을 수 있음. 정확히 읽을 것.
   - 발문 아래에 별도의 문장이 제시된 경우(예: 삽입 유형의 "주어진 문장", 요약 유형의 빈칸 문장 등)는
     발문과 \\n\\n으로 구분하여 question_text에 함께 포함할 것.
   - 예: "주어진 문장이 들어갈 위치로 가장 적절한 곳을 고르시오.\\n\\nHowever, this approach has *significant* limitations."
   - 인라인 서식(굵은 글씨, 이탤릭, 밑줄)은 passage와 동일한 방식으로 보존.

5. choices: 보기 배열 (문자열 5개). 예: ["① 감사", "② 항의", ...]
   - 원문 번호(①②③④⑤) 포함하여 그대로 기재.
   - 보기가 없는 서술형이면 빈 배열 [].

6. answer: 항상 빈 문자열 "" 고정. 정답을 추론하거나 생성하지 말 것.

━━━ 주의사항 ━━━
- **추출 범위: 18번~45번만. 17번 이하는 절대 포함하지 말 것.**
- **도표/그래프 문항(question_type: chart)은 추출하지 말 것.** 도표 이미지가 포함된 문항은 텍스트로 복원 불가하므로 완전히 건너뛸 것.
- 2단 편집 레이아웃: 왼쪽 → 오른쪽 순서로 읽을 것.
- 장문(두 문항이 하나의 지문을 공유)은 각 문항을 별도 객체로 만들되, passage는 동일한 텍스트를 양쪽 모두에 넣을 것.
- JSON 문자열 내 큰따옴표는 \\"로 이스케이프.
- \\n은 실제 줄바꿈을 의미.

━━━ 출력 형식 ━━━
JSON 배열만 출력 (다른 텍스트 없이):
[{"question_number":18,"question_type":"purpose","passage":"Dear Mr. Harrison,\\nI am writing to...","question_text":"다음 글의 목적으로 가장 적절한 것은?","choices":["① 감사","② 항의","③ 안내","④ 사과","⑤ 초대"],"answer":""}]`