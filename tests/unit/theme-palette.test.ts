import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/app/theme-tokens.css', 'utf8')
const darkBlock = css.match(/:root\.dark\s*\{([^}]+)\}/)?.[1] ?? ''
const palette = Object.fromEntries([...darkBlock.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi)].map(m => [m[1], m[2]]))

function luminance(hex: string) {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(part => {
    const channel = parseInt(part, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('dark reading contrast', () => {
  it.each(['share-ink', 'share-body', 'share-body2', 'share-muted', 'share-muted2'])('%s remains readable on every reading surface', foreground => {
    for (const background of ['share-canvas', 'share-card', 'share-box']) {
      expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each([
    ['control-fg', 'control-bg'],
    ['control-on-selected', 'control-selected'],
    ['accent-foreground', 'accent'],
    ['share-blue', 'share-blue-bg'],
    ['share-red', 'share-red-bg'],
    ['share-on-solid', 'share-blue-solid'],
    ['primary-foreground', 'primary'],
  ])('%s is readable on %s', (foreground, background) => {
    expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5)
  })
})
