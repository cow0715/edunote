import { createLlmExecution, llmCallKey } from '../llm/client'
import type { CallLlmOptions, LlmDetailedResult } from '../llm/types'
import { getPdfWorkerContext } from '../pdf-import/context'

/** Read only exact, known request versions. Never match just a question number,
 * model output, or a prompt hash with different PDF/coordinate evidence. */
export async function readCachedBookCall(versions: CallLlmOptions[]): Promise<LlmDetailedResult | null> {
  const context = getPdfWorkerContext()
  if (!context?.batchCall) return null
  for (const options of versions) {
    if (!options.task.startsWith('book.')) throw Error('Only textbook request compatibility is supported')
    const execution = options.execution ?? createLlmExecution(), key = llmCallKey(options, execution)
    const result = await context.read<LlmDetailedResult>(key)
      ?? (await context.read<{ result?: LlmDetailedResult }>(`batch-result:${key}`))?.result
    if (result?.execution?.task === options.task && result.execution.requestedModel === execution.taskBindings[options.task]
      && typeof result.text === 'string') return result
  }
  return null
}
