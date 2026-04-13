import { anthropic } from '@/lib/anthropic'
import { err } from '@/lib/api'

export const runtime = 'edge'
export const maxDuration = 300

const EXTRACT_PROMPT = `너는 시험지 PDF에서 문제를 추출하는 OCR 및 텍스트 복원 시스템이다.

사용자가 제공한 PDF 파일을 분석하여, 문제 내용을 "있는 그대로" 텍스트로 추출하라.

이 기능의 목적은 사람이 한글(HWP)에 복사하여 바로 사용할 수 있도록 하는 것이다.

--------------------------------------------------

[핵심 목표]

- PDF의 내용을 최대한 원본 그대로 텍스트로 변환
- 문제의 흐름과 읽는 구조 유지
- 불필요한 해석/가공 절대 금지

--------------------------------------------------

[절대 규칙]

1. 절대 요약하지 말 것
2. 절대 문장을 수정하거나 자연스럽게 고치지 말 것
3. 원문의 영어 문장은 단어 하나도 바꾸지 말 것
4. 오탈자도 그대로 유지할 것
5. 문제 순서 절대 변경 금지

--------------------------------------------------

[레이아웃 유지 규칙]

1. 줄바꿈은 원본과 최대한 유사하게 유지할 것
2. 문제 단위는 반드시 구분되도록 할 것 (빈 줄 1~2줄 허용)
3. 다음 요소는 그대로 유지:
   - 문제 번호 (예: [서답형 3], 18번 등)
   - (A), (B), (   ) 빈칸
   - 화살표(→, ↓ 등)
4. 보기 항목은 반드시 한 줄씩 분리:
   예:
   ① ...
   ② ...
5. <보기>, <조건> 같은 구분자는 그대로 유지

--------------------------------------------------

[지문/문제 처리 기준]

- 지문, 발문, 문제, 보기 구분을 억지로 만들지 말고
  "보이는 흐름 그대로" 유지할 것
- 문단 구조를 임의로 합치거나 나누지 말 것

--------------------------------------------------

[제거 대상]

다음은 반드시 제거할 것:
- 손글씨 답안
- 체크 표시, 동그라미
- 낙서, 필기 흔적

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
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return err('PDF 파일이 필요합니다')
    }

    if (file.type !== 'application/pdf') {
      return err('PDF 파일만 업로드 가능합니다')
    }

    const buffer = await file.arrayBuffer()
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
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

    return new Response(text, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return err(`추출 실패: ${msg}`, 500)
  }
}
