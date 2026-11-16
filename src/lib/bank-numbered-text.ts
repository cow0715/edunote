/** Presentation only: a PDF line break after a circled number is not a paragraph.
 * Keep consecutive bare markers and section boundaries; never edit stored text. */
export function joinBankNumberedContent(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(
    /([①-⑳])([ \t]*(?:<\/(?:u|strong|em|b|i)>[ \t]*)*)\n[ \t]*(?:\n[ \t]*)*(?=[^\s①-⑳\[])/g,
    '$1$2 ',
  )
}

export function bankChoiceText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A fixed five-slot answer record can represent markers printed inside the passage. */
export function hasInlineBankChoices(choices: readonly string[], passage: string | null) {
  const markers = Array.from('①②③④⑤')
  const body = (passage ?? '').replace(/[❶❷❸❹❺]/g, c => markers['❶❷❸❹❺'.indexOf(c)])
  return choices.length === markers.length && choices.every((c, i) => c.trim() === markers[i] && body.includes(markers[i]))
}
