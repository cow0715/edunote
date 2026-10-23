export function bookProgress(manifest: { units?: unknown[]; question_count?: number } | null, completed: number) {
  return { total: manifest?.units?.length ?? 0, questions: manifest?.question_count ?? 0,
    completed: Math.max(0, Math.min(manifest?.units?.length ?? 0, completed)) }
}
