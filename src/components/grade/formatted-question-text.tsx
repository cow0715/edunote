'use client'

type FormattedQuestionTextProps = {
  text: string
  className?: string
}

function renderInlineMarkup(text: string) {
  const parts = text.split(/(<u>[\s\S]*?<\/u>|\*\*[\s\S]*?\*\*)/g)

  return parts.map((part, index) => {
    if (!part) return null
    if (part.startsWith('<u>') && part.endsWith('</u>')) {
      return (
        <u key={index} className="decoration-2 underline-offset-2">
          {part.slice(3, -4)}
        </u>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function isGlossaryLine(text: string) {
  return /^\s*\*[\p{L}\p{N}]/u.test(text) || /\s\*[\p{L}\p{N}]/u.test(text)
}

function isChoiceLine(text: string) {
  return /^\s*(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/.test(text)
}

function splitQuestionBlocks(text: string) {
  const initialBlocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/)
  const blocks: string[] = []

  for (const block of initialBlocks) {
    const lines = block.split('\n')
    let current: string[] = []

    for (const line of lines) {
      const shouldStartNewBlock =
        current.length > 0 &&
        (isGlossaryLine(line) || isChoiceLine(line)) &&
        !current.every((item) => isGlossaryLine(item) || isChoiceLine(item))

      if (shouldStartNewBlock) {
        blocks.push(current.join('\n'))
        current = []
      }
      current.push(line)
    }

    if (current.length > 0) blocks.push(current.join('\n'))
  }

  return blocks.filter((block) => block.trim().length > 0)
}

export function FormattedQuestionText({ text, className }: FormattedQuestionTextProps) {
  const blocks = splitQuestionBlocks(text)

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n')
        return (
          <div key={blockIndex} className={blockIndex > 0 ? 'mt-3' : undefined}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {isGlossaryLine(line) ? line : renderInlineMarkup(line)}
                {lineIndex < lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </div>
        )
      })}
    </div>
  )
}
