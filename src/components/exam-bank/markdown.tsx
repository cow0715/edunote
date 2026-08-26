'use client'

import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { Label } from '@/components/ui/label'
import type { ExamBankQuestion } from './types'

// ── 마크다운 인라인 렌더러 ────────────────────────────────────────────────
// **bold**, *italic*, <u>underline</u>을 React 요소로 변환

// 각주 마커(* word, ** word)와 구분: 여는 * 뒤에 공백 없음, 닫는 * 앞에 공백 없음
const MD_TOKEN_RE = /(\*\*(?!\s)[^*]+(?<!\s)\*\*|\*(?!\s)(?!\*)[^*]+(?<!\s)\*|<u>[^<]+<\/u>)/g

// 마크다운 → HTML (한글/워드 붙여넣기용)
export function mdToHtml(text: string): string {
  return text
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?!\s)(?!\*)([^*]+?)(?<!\s)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>')
}

// 마크다운 기호 제거 (plain text용)
export function mdToPlain(text: string): string {
  return text
    .replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, '$1')
    .replace(/\*(?!\s)(?!\*)([^*]+?)(?<!\s)\*/g, '$1')
    .replace(/<u>([^<]+)<\/u>/g, '$1')
}

function normalizeCopyBlock(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n{2,}(?=\*\s*[A-Za-z][^\n]{0,80}[가-힣])/g, '\n\n')
    .trim()
}

export function buildQuestionCopyText(q: ExamBankQuestion, label: string) {
  const circled = ['①','②','③','④','⑤']
  const ratesSummary = q.choice_rates?.some((r) => r != null)
    ? `\n선택률: ${q.choices.map((_, i) => {
        const r = q.choice_rates?.[i]
        return r != null ? `${circled[i]} ${r}%` : null
      }).filter(Boolean).join('   ')}`
    : ''
  const headParts = [`[${label}]`, normalizeCopyBlock(mdToPlain(q.question_text))]
  const passage = normalizeCopyBlock(mdToPlain(q.passage ?? ''))
  if (passage) headParts.push(passage)
  const choicesText = q.choices.map((choice) => normalizeCopyBlock(mdToPlain(choice))).join('\n').trim()
  const passageText = headParts.filter(Boolean).join('\n') + (choicesText ? '\n\n\n' : '')

  return [
    passageText + choicesText,
    q.answer ? `정답: ${q.answer}` : '',
    ratesSummary.trim(),
  ].filter(Boolean).join('\n')
}

export function buildQuestionCopyHtml(q: ExamBankQuestion, label: string) {
  const chunks = [
    `<p><strong>[${label}]</strong></p>`,
    `<p>${mdToHtml(normalizeCopyBlock(q.question_text))}</p>`,
  ]
  const passage = normalizeCopyBlock(q.passage ?? '')
  if (passage) chunks.push(`<p>${mdToHtml(passage)}</p>`)
  if (q.choices.length > 0) chunks.push('<p><br></p>')
  if (q.choices.length > 0) {
    chunks.push(`<p>${q.choices.map((choice) => mdToHtml(normalizeCopyBlock(choice))).join('<br>')}</p>`)
  }
  if (q.answer) chunks.push(`<p>정답: ${q.answer}</p>`)
  return chunks.join('')
}

export async function copyRich(plainText: string, htmlText: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
        'text/html': new Blob([htmlText], { type: 'text/html' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(plainText)
  }
}

function renderLine(line: string, lineKey: number) {
  const parts = line.split(MD_TOKEN_RE)
  return (
    <span key={lineKey}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>
        }
        if (part.startsWith('<u>') && part.endsWith('</u>')) {
          return <u key={i}>{part.slice(3, -4)}</u>
        }
        return part
      })}
    </span>
  )
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  // 정규식 split 은 줄마다 비싸므로 text 가 바뀔 때만 다시 파싱한다.
  const rendered = useMemo(() => {
    const lines = text.split('\n')
    return lines.map((line, i) => (
      <span key={i}>
        {renderLine(line, i)}
        {i < lines.length - 1 && <br />}
      </span>
    ))
  }, [text])
  return <span className={className}>{rendered}</span>
}

export function MarkdownField({
  label,
  value,
  onChange,
  placeholder,
  minRows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}) {
  const editor = useEditor({
    // Next.js(SSR) 환경에서는 반드시 false 여야 한다.
    // 설정하지 않으면 Tiptap 이 "SSR has been detected" 예외를 던져
    // 문항 수정 다이얼로그를 여는 순간 페이지 전체가 크래시한다.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false }),
      Underline,
      Markdown.configure({ html: true, transformPastedText: true }),
    ],
    content: value,
    onUpdate({ editor }) {
      onChange((editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown())
    },
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[60px] text-sm text-gray-800 leading-relaxed',
      },
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>{label}</Label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run() }}
            className={`rounded px-1.5 py-0.5 text-xs font-bold border ${editor?.isActive('bold') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >B</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run() }}
            className={`rounded px-1.5 py-0.5 text-xs italic border ${editor?.isActive('italic') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >I</button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor?.chain().focus().toggleUnderline().run() }}
            className={`rounded px-1.5 py-0.5 text-xs underline border ${editor?.isActive('underline') ? 'bg-gray-200 border-gray-400' : 'border-gray-200 hover:bg-gray-100'}`}
          >U</button>
        </div>
      </div>
      <div
        className="rounded-md border bg-white px-3 py-2 text-sm focus-within:ring-1 focus-within:ring-ring"
        style={{ minHeight: `${minRows * 1.75 + 1}rem` }}
      >
        {editor && !editor.getText() && !editor.isFocused && (
          <p className="pointer-events-none absolute text-gray-400 text-sm">{placeholder}</p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
