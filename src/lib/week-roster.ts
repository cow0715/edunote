type Membership = { student_id: string; joined_at?: string | null; left_at?: string | null; created_at?: string }

/** Historical records remain visible even when imported enrollment dates disagree. */
export function rosterAtDate<T extends Membership>(memberships: T[], date: string | null, recordedStudentIds: Iterable<string> = []): T[] {
  const recorded = new Set(recordedStudentIds)
  return memberships.filter(member => {
    if (recorded.has(member.student_id)) return true
    if (!date) return !member.left_at
    const joined = member.joined_at ?? member.created_at?.slice(0, 10)
    return (!joined || joined <= date) && (!member.left_at || member.left_at > date)
  })
}
