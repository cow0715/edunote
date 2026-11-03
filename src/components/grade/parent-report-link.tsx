import { ExternalLink } from 'lucide-react'

export function ParentReportLink({ token, studentName }: { token: string; studentName: string }) {
  return <a href={`/share/${token}`} target="_blank" rel="noopener noreferrer"
    aria-label={`${studentName} 학부모 화면 새 탭에서 열기`}
    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9">
    학부모 화면<ExternalLink aria-hidden="true" className="size-3.5" />
  </a>
}
