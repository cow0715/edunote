import { anthropic } from '@/lib/anthropic'
import { err } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 300

const EXTRACT_PROMPT = `너는 시험지 PDF에서 문제와 해설을 추출하는 OCR 및 텍스트 복원 시스템이다.

사용자가 제공한 PDF 파일을 분석하여, 문제(와 해설이 있다면 해설)를 텍스트로 추출하라.

이 기능의 목적은 사람이 한글(HWP)에 붙여넣어 바로 편집할 수 있도록 하는 것이다.

--------------------------------------------------

[핵심 목표]

- PDF의 내용을 원본 그대로 텍스트로 변환
- 한글에 붙여넣기 좋은 "자연스러운" 형태로 출력
- 불필요한 해석/가공 절대 금지

--------------------------------------------------

[절대 규칙]

1. 절대 요약하지 말 것
2. 절대 문장을 수정하거나 자연스럽게 고치지 말 것
3. 원문의 영어 문장은 단어 하나도 바꾸지 말 것
4. 오탈자도 그대로 유지할 것
5. 문제 순서 절대 변경 금지

--------------------------------------------------

[번호 규칙 — 매우 중요]

- 각 문제의 시작 줄 맨 앞에 반드시 "1번", "2번", "3번" 형식의 번호를 붙일 것
- PDF에 원래 적힌 번호가 "18", "[서답형 3]" 등으로 달라도 **등장 순서대로 1번, 2번, 3번…** 으로 다시 매길 것
- 번호 뒤에는 공백 한 칸 후 문제 내용 시작
  예:
  1번 다음 글의 빈칸에 들어갈 말로 가장 적절한 것은?
  2번 밑줄 친 부분의 의미로 알맞은 것은?

--------------------------------------------------

[줄바꿈 규칙 — 매우 중요]

1. PDF의 시각적 줄바꿈은 **무시**할 것
   - 한 문장/문단이 여러 줄에 걸쳐 있어도 한 줄로 이어 붙일 것
   - 오직 "문단/의미 단위"가 바뀔 때만 줄바꿈
2. 문제 사이는 빈 줄 1줄로 구분
3. 보기 항목(①②③④⑤)만 각각 한 줄씩 분리:
   ① ...
   ② ...
4. <보기>, <조건> 같은 구분자는 그대로 유지
5. (A), (B), (   ) 빈칸, 화살표(→, ↓)는 원문 그대로 유지

--------------------------------------------------

[해설 처리 기준]

- PDF에 해설지가 포함되어 있으면 문제 추출 후 이어서 해설도 추출할 것
- 해설 섹션 시작 전에 다음 구분선을 출력:

==================== 해설 ====================

- 해설도 문제와 동일한 번호 체계(1번, 2번...)로 매칭
  예:
  1번 정답: ③
  빈칸 앞뒤 문맥상 ~
- 해설이 없으면 해설 섹션은 출력하지 않음

--------------------------------------------------

[제거 대상]

다음은 반드시 제거할 것:
- 손글씨 답안, 체크 표시, 동그라미, 낙서, 필기 흔적
- 시험지 머리말/꼬리말(학교명, 배점표, 페이지 번호 등 부수 요소)

--------------------------------------------------

[출력 형식]

- 설명 없이 결과 텍스트만 출력
- JSON 절대 금지
- 마크다운 사용하지 말 것
- 코드블록 사용하지 말 것

--------------------------------------------------

[보정 규칙]

- 텍스트가 일부 깨진 경우, 문맥을 기반으로 "최소한으로만" 복원할 것
- 하지만 새로운 문장을 만들거나 의미를 바꾸지 말 것

--------------------------------------------------

[최종 목표]

"PDF를 사람이 복사한 것처럼 최대한 유사한 텍스트"`

export async function POST(request: Request) {
  try {
    const { path } = await request.json()

    if (!path || typeof path !== 'string') {
      return err('path가 필요합니다')
    }

    const supabase = createServiceClient()

    // service role로 Storage에서 직접 다운로드 (강사 권한 불필요)
    const { data, error } = await supabase.storage.from('pdf-temp').download(path)
    if (error || !data) {
      return err(`PDF 다운로드 실패: ${error?.message}`)
    }

    const buffer = await data.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64 },
            },
            { type: 'text', text: EXTRACT_PROMPT },
          ],
        },
      ],
    })

    const msg = await stream.finalMessage()
    const text = msg.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('\n')
      .trim()

    // 임시 파일 삭제 (실패해도 무시)
    await supabase.storage.from('pdf-temp').remove([path]).catch(() => {})

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`추출 실패: ${msg}`, 500)
  }
}
