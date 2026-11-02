'use client'

import { Pencil } from 'lucide-react'

/** Common editing affordance for vocabulary, reading and homework scores. */
export function GradeEditIcon() {
  return <Pencil aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
}
