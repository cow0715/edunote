'use client'

// 단어 카드의 부속 조각 — 오답 탭·단어 탭이 같은 걸 쓰도록 한 곳에 모은다.
//
// 리디자인 이후 색 규칙(design_handoff_share_report/README.md):
//   · 유의/반의/파생 칩은 전부 회색이다. 예전에는 유의 blue / 반의 amber 였는데,
//     관계 종류는 라벨로 이미 구분되므로 색까지 쓸 이유가 없다.
//   · 정오는 "내 답 빨강 취소선 / 정답 잉크" 다. 초록은 쓰지 않는다.

import { VocabWord } from './share-types'

/**
 * share 리포트 안에서의 정오 표기.
 *
 * 채점 화면(components/grade/*)은 초록=정답 관습을 그대로 쓴다 — 거긴 선생님용이고
 * 정오를 빠르게 훑는 화면이라 관습이 더 강하다. 여기만 리포트 팔레트를 따른다.
 */
export const SHARE_WRONG_CLASS = 'font-semibold text-[#F04452] line-through decoration-[#F04452]/40'
export const SHARE_RIGHT_CLASS = 'font-semibold text-[#191F28]'

/** 어휘 관계 — 전부 회색 칩. 라벨로 구분한다 */
export function WordRelationChips({ word, className }: { word: VocabWord; className?: string }) {
  const synonyms = word.synonyms ?? []
  const antonyms = word.antonyms ?? []
  if (synonyms.length === 0 && antonyms.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {synonyms.map((value, index) => (
        <span
          key={`syn-${value}-${index}`}
          className="rounded-full bg-[#F2F4F6] px-2 py-0.5 text-[11px] font-medium text-[#4E5968]"
        >
          유의 {value}
        </span>
      ))}
      {antonyms.map((value, index) => (
        <span
          key={`ant-${value}-${index}`}
          className="rounded-full bg-[#F2F4F6] px-2 py-0.5 text-[11px] font-medium text-[#4E5968]"
        >
          반의 {value}
        </span>
      ))}
    </div>
  )
}

/** 예문 박스 — 카드 안 한 겹 안쪽이라 흰 배경 */
export function ExampleBox({
  sentence,
  translation,
  className,
}: {
  sentence: string
  translation?: string | null
  className?: string
}) {
  return (
    <div className={`rounded-[12px] bg-white px-3 py-2 ${className ?? ''}`}>
      <p className="text-[12px] italic leading-relaxed text-[#333D4B]">{sentence}</p>
      {translation && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#8B95A1]">{translation}</p>
      )}
    </div>
  )
}

/** 보조 설명 블록 (해설 / 첨삭) */
export function NoteBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] bg-white px-3 py-2.5">
      <p className="mb-1 text-[10px] font-bold tracking-wide text-[#8B95A1]">{label}</p>
      <div className="text-[12.5px] leading-relaxed text-[#4E5968]">{children}</div>
    </div>
  )
}

/** 유형 태그칩 — 무채색. 색을 빼야 내 답/정답이 먼저 읽힌다 */
export function ConceptChip({ name }: { name: string }) {
  return (
    <span className="rounded-full bg-[#F2F4F6] px-2 py-0.5 text-[11px] font-medium text-[#6B7684]">
      {name}
    </span>
  )
}
