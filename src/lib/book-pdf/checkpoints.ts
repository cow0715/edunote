import { createLlmExecution, llmCallKey } from '../llm/client'
import type { CallLlmOptions, LlmDetailedResult } from '../llm/types'
import { getPdfWorkerContext } from '../pdf-import/context'
import { MODEL_IDS } from '../llm/models'

/** Read only exact, known request versions. Never match just a question number,
 * model output, or a prompt hash with different PDF/coordinate evidence. */
export async function readCachedBookCall(versions: CallLlmOptions[]): Promise<LlmDetailedResult | null> {
  const context = getPdfWorkerContext()
  if (!context?.batchCall) return null
  for (const options of versions) {
    if (!options.task.startsWith('book.')) throw Error('Only textbook request compatibility is supported')
    const execution = options.execution ?? createLlmExecution()
    // The deployed October 29 routing catalog fingerprint is immutable. A later
    // catalog change must not force a new paid request for identical evidence.
    // Only the identity is reconstructed: these old versions are NEVER sent.
    const historic = { ...execution, configVersion: 'routing-v1:4aed6b2450f3', taskBindings: { ...execution.taskBindings,
      'book.mapSource': MODEL_IDS.sonnet55, 'book.auditSource': MODEL_IDS.sonnet55, 'book.enrichMaterial': MODEL_IDS.sonnet55 } }
    for (const version of [execution, historic]) {
      const key = llmCallKey(options, version), configVersion = version.configVersion
      const result = await context.read<LlmDetailedResult>(key)
        ?? (await context.read<{ result?: LlmDetailedResult }>(`batch-result:${key}`))?.result
      if (result?.execution?.task === options.task && result.execution.requestedModel === version.taskBindings[options.task]
        && result.execution.configVersion === configVersion && (!result.execution.callKey || result.execution.callKey === key)
        && typeof result.text === 'string') {
        await context.rememberBookCall?.(options, key, result)
        return result
      }
    }
  }
  return null
}
