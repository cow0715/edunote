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
  → 예 → is_correct: true`

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
- "모범답안과 다릅니다"처럼 막연한 피드백 금지 — 구체적 차이를 명시할 것`

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

3. subjective
   조건: 정답이 영어 단어·구·문장 텍스트
   (단답형, 빈칸완성, 영작, 어법교정, 내용유추, 요약완성 등 모두 포함)

4. objective
   조건: 나머지 — 정답이 ①~⑤ 중 1개

━━━ STEP 2 — 소문항(sub_label) 분리 여부 ━━━

하나의 문항 번호 안에 독립적으로 채점되는 답이 여러 개면 소문항으로 분리한다.

[분리 O]
① (A)(B)(C)(D) 등 복수 빈칸
   한 줄 나열이어도 반드시 분리
   예) "[정답] : (A) enough (B) greenhouse (C) crowdfunding campaign (D) reward"
   → sub_label a: "enough" / b: "greenhouse" / c: "crowdfunding campaign" / d: "reward"

② "모두 순서대로 쓰시오" 형 어법교정
   발문: "어색한 것은 고치고, 옳은 것은 그대로 기호에 맞게 순서대로 쓰시오"
   ⓐ부터 끝까지 전부 답해야 하므로 기호별로 sub_label 분리
   - 수정 항목: correct_answer_text = "→" 이후 수정어만 저장
     ✅ 올바른 예: correct_answer_text = "thrilled"
     ❌ 잘못된 예: correct_answer_text = "thrilling → thrilled"  (원래 표현 포함 금지)
     ❌ 잘못된 예: correct_answer_text = "X (thrilling → thrilled)"  (X 접두사 금지)
     이유: 학생은 답안지에 수정어만 쓰기 때문
   - 옳은 항목: correct_answer_text = 원래 단어 그대로 (예: "figuring") ← "O" 저장 절대 금지

③ "틀린 것을 찾아 고치시오" 형 어법교정
   발문: "어법에 맞지 않는 표현이 있는 문장의 기호를 모두 찾아 고치시오"
   틀린 항목만 sub_label로 분리한다 (옳은 항목은 row 생성 X)
   - correct_answer_text = 수정어만 (기호·원래 표현 포함 금지)
     ✅ 올바른 예: correct_answer_text = "asked"
     ❌ 잘못된 예: correct_answer_text = "ⓒ ask → asked"  (기호·화살표 포함 금지)
   - question_style = "subjective"
   예) 정답: "ⓒ ask → asked / ⓔ committed to supporting" (ⓓ는 옳음)
   → sub_label "c": correct_answer_text="asked" / sub_label "e": correct_answer_text="committed to supporting"
   → ⓓ는 row 생성 안 함

[분리 X]
④ multi_select 정답의 선택지 기호 (정답이 "b,c,f"인 경우)
   선택지가 소문항처럼 보여도 sub_label = null, correct_answer_text = "b,c,f"

- sub_label 정규화: A→"a", B→"b", ①→"a", ②→"b" (소문자 알파벳 순)

━━━ STEP 3 — correct_answer / correct_answer_text ━━━

- objective   : correct_answer = 정답 번호 1~5 (①→1, ②→2 … ⑤→5), correct_answer_text = null
- ox          : correct_answer = 0, correct_answer_text = "O" 또는 "X (수정어)" (예: "X (has)")
- multi_select: correct_answer = 0, correct_answer_text = 쉼표 구분 (예: "1,3" / "a,c,f"), ①→1 변환
- subjective  : correct_answer = 0, correct_answer_text = 학생이 실제로 써야 할 텍스트

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
- 결석 학생: 반드시 한 줄 언급. 예: "상담실에서 수업 자료 수령 및 과제 제출 부탁드립니다."

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
  return `단어 시험지 OCR 결과와 이미지를 함께 참고해 각 문항을 파악하세요.

CLOVA OCR 텍스트:
${clovaText}

규칙:
- 번호, 인쇄된 영어 단어(구), 학생이 손으로 쓴 한글 답을 구분하세요
- OCR 텍스트를 우선 사용하고, 불명확한 부분은 이미지로 보완하세요
- 두 단어 중 선택 문항: 이미지에서 동그라미 친 단어를 확인하세요 (예: "immune / condemned")
- 판독 불가면 null, 미기재면 ""

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"},{"number":2,"english_word":"abandon","student_answer":null},{"number":43,"english_word":"immune / condemned","student_answer":"immune"},{"number":50,"english_word":"showing great attention to detail or correct behavior","student_answer":"meticulous"}]`
}

// ── 단어 시험지 OCR (Claude Vision) ─────────────────────────────────────

export const VOCAB_OCR_VISION_PROMPT = `이 단어 시험지에서 각 문항의 내용을 읽어주세요.

규칙:
- 인쇄된 번호와 영어 단어(구) 또는 문장을 정확히 읽으세요
- 학생이 손으로 쓴 한글 답은 보이는 그대로만 읽으세요 (판독 불가면 null, 미기재면 "")
- 두 단어 중 선택하는 문항: 학생이 동그라미 친 단어를 읽으세요 (확인 불가면 null)
- 절대 내용을 추측하거나 수정하지 마세요. 채점하지 마세요.

JSON 배열만 출력:
[{"number":1,"english_word":"necessary","student_answer":"필수적인"},{"number":2,"english_word":"abandon","student_answer":null},{"number":43,"english_word":"immune / condemned","student_answer":"immune"},{"number":50,"english_word":"showing great attention to detail or correct behavior","student_answer":"meticulous"}]`

// ── 단어 채점 ────────────────────────────────────────────────────────────

export function buildVocabGradingPrompt(items: { number: number; english_word: string; student_answer: string | null }[]): string {
  return `단어 시험 답안을 채점하세요.

━━━ 공통 규칙 (모든 유형 적용) ━━━
- student_answer가 null이거나 ""이면 무조건 오답
- 품사 판단:
  · 해당 영어 단어가 가질 수 있는 품사 중 하나와 일치하면 정답
    예) "further"는 부사/형용사/동사 → "추가적인(형용사)" ✅ / "더 나아가(부사)" ✅
  · 영어 단어가 가질 수 없는 품사이면 오답
    예) "necessary(형용사 전용)" → "필수(명사)" ❌ / "필수적인(형용사)" ✅
    예) "justify(동사 전용)" → "정당(명사)" ❌ / "정당화하다(동사)" ✅
- 애매한 경우 판단 기준: "이 학생이 이 단어의 의미를 알고 있는가?"
  → 알고 있다고 판단되면 학생에게 유리하게 정답 처리
  → 의미를 반대로 이해하거나 전혀 다른 뜻이면 오답
  예) "further" → "멀리" ✅ (거리/방향 의미를 이해한 것으로 판단)
  예) "barely" → "거의" ❌ (간신히 ↔ 거의: 반대 뉘앙스이므로 오답)
  예) "barely" → "간신히" ✅

━━━ 문제 유형별 처리 ━━━

[유형 A] 영어 단어(구) → 한글 뜻 쓰기
판단 기준:
1. 학생이 이 단어의 의미를 알고 있는지 기준으로 판단 — 애매하면 정답 처리
2. 품사가 다르면 오답 (공통 규칙 적용)
3. 피동/능동 구분 엄격 적용 ("-되다" vs "-하다")
4. 주어/목적어/방향 관계가 뒤바뀌면 오답
5. 철자가 약간 틀려도 의도가 명확하면 허용
6. 동의어는 품사와 핵심 의미가 같으면 허용

[유형 B] 두 단어 중 선택 (english_word에 "/" 포함, 예: "immune / condemned")
- 해당 문장/문맥에서 문법·의미상 올바른 단어를 당신이 직접 판단
- student_answer(학생이 선택한 단어)와 비교해 is_correct 결정

[유형 C] 영어 설명 → 영어 단어 쓰기 (english_word가 영어 설명문인 경우)
- student_answer가 영어 단어·구
- 영어 설명이 의미하는 단어와 품사·의미 모두 일치해야 정답
- 철자 오류는 의도가 명확하면 허용

채점할 답안:
${JSON.stringify(items)}

JSON 배열만 출력 (number, english_word, student_answer, is_correct 포함):
[{"number":1,"english_word":"necessary","student_answer":"필수적인","is_correct":true},{"number":43,"english_word":"immune / condemned","student_answer":"immune","is_correct":true}]`
}

// ── 단어 PDF 파싱 ────────────────────────────────────────────────────────

export const VOCAB_PDF_PROMPT = `이 파일은 영어 단어 시험지입니다.
각 문항의 번호와 영어 단어(구)를 추출하고, 각 단어 정보를 JSON으로 반환하세요.

규칙:
- number: 문항 번호 (정수)
- english_word: 인쇄된 영어 단어 또는 구 (원본 그대로)
- correct_answer: 가장 일반적으로 쓰이는 한국어 뜻 (다의어는 " / " 구분, 최대 2개). 두 단어 선택형(예: "immune / condemned")은 null
- synonyms: 대표 유의어 영어 단어 2~3개 배열. 두 단어 선택형은 []
- antonyms: 대표 반의어 영어 단어 1~2개 배열. 없으면 []

JSON 배열만 출력:
[{"number":1,"english_word":"inhibit","correct_answer":"억제하다","synonyms":["suppress","restrain"],"antonyms":["encourage","promote"]},{"number":2,"english_word":"immune / condemned","correct_answer":null,"synonyms":[],"antonyms":[]}]`