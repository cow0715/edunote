import { bookFingerprint } from './proof'
import type { CallLlmOptions } from '../llm/types'

/** Provider retry keys remain unchanged. This second identity prevents a prompt
 * or routing change from buying the same document/unit/evidence operation again. */
export function bookRequestIdentity(options: CallLlmOptions, documentId: string, unitKey: string) {
  return bookFingerprint({ version: 1, documentId, unitKey, task: options.task, ...(options.bookAttempt ? { manualAttempt: options.bookAttempt } : {}),
    operation: options.bookOperation ?? { kind: 'legacy', evidence: options.content } })
}
