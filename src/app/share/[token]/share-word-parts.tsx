'use client'

// 단어 카드의 부속 조각 — 오답노트·단어장이 같은 걸 쓰도록 한 곳에 모은다.
// 예전에는 두 탭이 각자 그려서 반의어가 한쪽은 purple, 한쪽은 amber 였고
// 라벨도 '반' / '반의' 로 갈렸다. 색·라벨의 원본은 이 파일이다.

import { VocabWord } from './share-types'

/** 어휘 관계 — 유의 blue / 반의 amber. 정오(rose·emerald)와 색이 겹치지 않게 고정 */
export function WordRelationChips({ word, className }: { word: VocabWord; className?: string }) {
  const synonyms = word.synonyms ?? []
  const antonyms = word.antonyms ?? []
  if (synonyms.length === 0 && antonyms.length === 0) return null

  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {synonyms.map((value, index) => (
        <span
          key={`syn-${value}-${index}`}
          className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
        >
          유의 {value}
        </span>
      ))}
      {antonyms.map((value, index) => (
        <span
          key={`ant-${value}-${index}`}
          className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          반의 {value}
        </span>
      ))}
    </div>
  )
}

/** 예문 박스 — 무채색. 카드의 색 예산은 정오 표시(rose/emerald)에만 쓴다 */
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
    <div className={`rounded-xl bg-gray-50 px-3 py-2 dark:bg-white/[0.05] ${className ?? ''}`}>
      <p className="text-xs italic leading-relaxed text-gray-700 dark:text-gray-300">{sentence}</p>
      {translation && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">{translation}</p>
      )}
    </div>
  )
}

/** 보조 설명 블록 (해설 / 첨삭) — 라벨로 구분하고 배경은 무채색으로 눌러둔다 */
export function NoteBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-white/[0.05]">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">{label}</p>
      <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{children}</div>
    </div>
  )
}

/** 유형 태그칩 — 무채색. 색을 빼야 내 답/정답이 먼저 읽힌다 */
export function ConceptChip({ name }: { name: string }) {
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.08] dark:text-gray-300">
      {name}
    </span>
  )
}
