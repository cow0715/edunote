import type { BookQuestionRef } from './types'

export type BookSourceLabel = { index: number; end: number; raw: string; ref: Omit<BookQuestionRef, 'label_page' | 'printed_answer'>; scope: string }

/** Print-to-PDF may place the parenthesis glyphs after the book name. Only
 * identity metadata is normalized; source passages and formatting are untouched. */
export function findBookSourceLabels(text: string): BookSourceLabel[] {
  const labels: BookSourceLabel[] = []
  for (const match of text.matchAll(/\[\s*(?:수능특강|수능완성)[^\]\n]{1,110}\]/g)) {
    const raw = match[0], value = raw.slice(1, -1).normalize('NFKC').replace(/[\s()]/g, '')
    const english = value.match(/^수능특강영어(\d+)강(Gateway(?:(\d+)번)?|(\d+)번)$/i)
    const reading = value.match(/^수능특강(?:영독|영어독해연습)(?:(\d+)강|MiniTest(\d+)회)(\d+)번$/i)
    const types = value.match(/^수능완성유형편(\d+)강(?:Practice(?:(\d+)(?:번)?)?|(\d+)번)$/i)
    const practical = value.match(/^수능완성실전편(\d+)회(\d+)번$/)
    let ref: BookSourceLabel['ref'] | null = null, scope = ''
    if (english) {
      const chapter = Number(english[1]), section = english[2].toLowerCase().startsWith('gateway') ? 'gateway' : 'exercise'
      const number = Number(english[3] ?? english[4] ?? 1)
      ref = { key: `${chapter}:${section}:${number}`, chapter, section, number, label: `${chapter}강 ${section === 'gateway' ? 'Gateway ' : ''}${number}번` }
      scope = `english:${chapter}:${section}`
    } else if (reading) {
      const mini = !!reading[2], chapter = Number(reading[1] ?? reading[2]), number = Number(reading[3])
      const part = mini ? 'mini_test' : 'chapter'
      ref = { key: `reading:${part}:${chapter}:${number}`, chapter, section: 'exercise', number,
        source_kind: part, label: `${mini ? 'Mini Test ' + chapter + '회' : chapter + '강'} ${number}번` }
      scope = `reading:${part}:${chapter}`
    } else if (types) {
      const chapter = Number(types[1]), section = types[3] ? 'exercise' : 'practice', number = Number(types[3] ?? types[2] ?? 1)
      ref = { key: `suwan:type:${chapter}:${section}:${number}`, chapter, section, number, source_kind: 'type',
        label: `유형편 ${chapter}강 ${section === 'practice' ? 'Practice ' : ''}${number}번` }
      scope = `suwan:type:${chapter}:${section}`
    } else if (practical) {
      const chapter = Number(practical[1]), number = Number(practical[2])
      ref = { key: `suwan:practical:${chapter}:${number}`, chapter, section: 'exercise', number, source_kind: 'practical', label: `실전편 ${chapter}회 ${number}번` }
      scope = `suwan:practical:${chapter}`
    }
    if (ref && ref.chapter > 0 && ref.number > 0) labels.push({ index: match.index!, end: match.index! + raw.length, raw, ref, scope })
  }
  return labels
}

/** A range heading can cover independent blank/order questions. It becomes a
 * shared passage only when the printed instruction says to read one text. */
export function bookSharedRange(text: string) {
  const m = text.match(/(?:^|\n)\s*\[(\d+)\s*[~～∼-]\s*(\d+)\]\s*(?:다음\s*글|(?=\n|$))/)
  if (!m || Number(m[1]) >= Number(m[2])) return null
  return { start: Number(m[1]), end: Number(m[2]) }
}

export function bookQuestionPageStart(prefix: string) {
  if (!prefix.trim()) return true
  // Preserve an English sentence/choice continued before the next label.
  // Only known book furniture and independent-question instructions may precede it.
  const withoutBookHeader = prefix.replace(/^\s*수능완성\s*[(（]\s*실전\s*[)）]\s*(?:\n|$)/, '').trim()
  return !withoutBookHeader || /^\[\d+\s*[~～∼-]\s*\d+\]\s*(?:다음\s*빈칸|주어진\s*글\s*다음|글의\s*흐름)[가-힣\s,.?]*$/.test(withoutBookHeader)
}
