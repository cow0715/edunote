'use client'

import { useId, useRef, useState, type ChangeEventHandler, type ReactNode, type RefObject } from 'react'
import { FileCheck2, Loader2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type FileUploadProps = {
  label: string
  description?: string
  accept: string
  multiple?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onChange: ChangeEventHandler<HTMLInputElement>
  fileName?: string
  disabled?: boolean
  loading?: boolean
  compact?: boolean
  className?: string
  preview?: ReactNode
  onClear?: () => void
  beforeSelect?: () => boolean
}

/** Selection only: existing callers own validation, upload, confirmation and progress. */
export function FileUpload({
  label, description, accept, multiple = false, inputRef, onChange, fileName,
  disabled = false, loading = false, compact = false, className, preview, onClear, beforeSelect,
}: FileUploadProps) {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const descriptionId = useId()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const unavailable = disabled || loading

  function select() {
    if (unavailable || beforeSelect?.() === false) return
    setError('')
    ref.current?.click()
  }

  return (
    <div className={cn('min-w-0', !compact && 'w-full', className)} data-slot="file-upload">
      <input ref={ref} type="file" accept={accept} multiple={multiple} disabled={unavailable}
        className="hidden" aria-label={label} onChange={onChange} />
      <button
        type="button" disabled={unavailable} aria-label={label} aria-busy={loading}
        aria-describedby={description ? descriptionId : undefined}
        onClick={select}
        onDragOver={(event) => {
          event.preventDefault()
          if (!unavailable) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (unavailable || !ref.current || beforeSelect?.() === false) return
          const files = Array.from(event.dataTransfer.files)
          if (!files.length) return
          const formats = accept.toLowerCase().split(',').map((format) => format.trim())
          if (files.some((file) => !formats.some((format) => format.startsWith('.')
            ? file.name.toLowerCase().endsWith(format)
            : format.endsWith('/*') ? file.type.startsWith(format.slice(0, -1)) : file.type === format))) {
            setError('지원하는 파일 형식을 확인해 주세요.')
            return
          }
          if (!multiple && files.length > 1) {
            setError('파일을 한 개씩 선택해 주세요.')
            return
          }
          setError('')
          // Use the same native change path as the picker; refs remain available to submit handlers.
          ref.current.files = event.dataTransfer.files
          ref.current.dispatchEvent(new Event('change', { bubbles: true }))
        }}
        className={cn(
          'flex max-w-full items-center justify-center gap-3 rounded-xl border text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'min-h-9 px-3 py-2 text-xs font-medium' : 'min-h-36 w-full flex-col border-dashed px-4 py-6 text-center',
          dragging ? 'border-ring bg-[var(--control-selected)]' : 'border-border bg-[var(--upload-bg)] hover:bg-[var(--control-bg)]',
        )}
      >
        {loading ? <Loader2 aria-hidden className="size-5 shrink-0 animate-spin text-muted-foreground" />
          : fileName ? <FileCheck2 aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            : <Upload aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium [overflow-wrap:anywhere]">{fileName || label}</span>
          {!compact && <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {fileName ? '클릭하거나 파일을 놓아 변경' : '클릭하거나 파일을 여기에 놓으세요'}
          </span>}
          {description && <span id={descriptionId} className={cn('mt-2 block text-xs leading-relaxed text-muted-foreground', compact && 'sr-only')}>{description}</span>}
        </span>
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {preview && <div className="mt-3">{preview}</div>}
      {fileName && onClear && <button type="button" disabled={unavailable} onClick={() => {
        if (ref.current) ref.current.value = ''
        setError('')
        onClear()
      }} className="mt-2 inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" aria-label={`${label} 선택 해제`}>
        <X aria-hidden className="size-3.5" />선택 해제
      </button>}
    </div>
  )
}
