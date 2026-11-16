/** Pinned on newly registered jobs so retries keep the same source IDs. */
export const LEGACY_BOOK_PDFIUM_SOURCE = 'pdfium-glyph-v1'
export const BOOK_PDFIUM_BOX_SOURCE = 'pdfium-glyph-v2'
export const BOOK_PDFIUM_SOURCE = 'pdfium-glyph-v3'
export type BookSourceMode = typeof BOOK_PDFIUM_SOURCE | typeof BOOK_PDFIUM_BOX_SOURCE | typeof LEGACY_BOOK_PDFIUM_SOURCE

export function hasBookLayoutEvidence(mode?: BookSourceMode) {
  return mode === BOOK_PDFIUM_BOX_SOURCE || mode === BOOK_PDFIUM_SOURCE
}

export function bookSourceMode(value: unknown): BookSourceMode | undefined {
  if (value === BOOK_PDFIUM_SOURCE || value === BOOK_PDFIUM_BOX_SOURCE || value === LEGACY_BOOK_PDFIUM_SOURCE) return value
}
