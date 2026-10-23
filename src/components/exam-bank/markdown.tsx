'use client'

import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown, type MarkdownStorage } from 'tiptap-markdown'
import { Label } from '@/components/ui/label'
import { materialInlineHtml, materialInlinePlain, parseMaterialInline, type MaterialInline } from '@/lib/material-inline'

// ── 마크다운 인라인 렌더러 ────────────────────────────────────────────────
// **bold**, *italic*, <u>underline</u>을 React 요소로 변환

// 각주 마커(* word, ** word)와 구분: 여는 * 뒤에 공백 없음, 닫는 * 앞에 공백 없음

// 마크다운 → HTML (한글/워드 붙여넣기용)
export function mdToHtml(text: string): string {
  return materialInlineHtml(parseMaterialInline(text))
}

// 마크다운 기호 제거 (plain text용)
export function mdToPlain(text: string): string {
  return materialInlinePlain(parseMaterialInline(text))
}

export { buildQuestionCopyText, buildQuestionCopyHtml, buildExplanationCopyText, buildExplanationCopyHtml } from '@/lib/exam-bank-copy'

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

function renderInline(nodes: MaterialInline[]): React.ReactNode {
  return nodes.map((node, i) => node.kind === 'text' ? node.text : node.kind === 'bold'
    ? <strong key={i}>{renderInline(node.children)}</strong> : node.kind === 'italic'
      ? <em key={i}>{renderInline(node.children)}</em> : <u key={i}>{renderInline(node.children)}</u>)
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  // 정규식 split 은 줄마다 비싸므로 text 가 바뀔 때만 다시 파싱한다.
  const rendered = useMemo(() => {
    const lines = text.split('\n')
    return lines.map((line, i) => (
      <span key={i}>
        {renderInline(parseMaterialInline(line))}
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
