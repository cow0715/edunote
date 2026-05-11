'use client'

import { useLayoutEffect, useRef, useState } from 'react'

type PrintFitTextProps = {
  text: string
  className?: string
  maxSize?: number
  minSize?: number
  step?: number
}

export function PrintFitText({ text, className = '', maxSize = 14, minSize = 9, step = 0.5 }: PrintFitTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [fontSize, setFontSize] = useState(maxSize)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    function fit() {
      const target = ref.current
      if (!target) return
      let nextSize = maxSize
      target.style.fontSize = `${nextSize}px`
      while (nextSize > minSize && target.scrollWidth > target.clientWidth) {
        nextSize = Math.max(minSize, nextSize - step)
        target.style.fontSize = `${nextSize}px`
      }
      setFontSize(nextSize)
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => observer.disconnect()
  }, [maxSize, minSize, step, text])

  return (
    <span
      ref={ref}
      className={`block min-w-0 overflow-hidden whitespace-nowrap ${className}`}
      style={{ fontSize }}
      title={text}
    >
      {text}
    </span>
  )
}
