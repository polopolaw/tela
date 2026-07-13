import { describe, expect, it } from 'vitest'
import { stampMacroDefIdsInMarkdown } from './stamp-macro-def-ids'

describe('stampMacroDefIdsInMarkdown', () => {
  it('stamps bare macro-def opener', () => {
    const out = stampMacroDefIdsInMarkdown(`:::macro-def
hello
:::`)
    expect(out).toMatch(/:::macro-def\{id="m_[^"]+"\}/)
    expect(out).toContain('hello')
  })

  it('stamps macro-def with empty braces', () => {
    const out = stampMacroDefIdsInMarkdown(`:::macro-def{}
x
:::`)
    expect(out).toMatch(/id="m_/)
  })

  it('leaves existing id intact', () => {
    const body = `:::macro-def{id="m_keep"}
x
:::`
    expect(stampMacroDefIdsInMarkdown(body)).toBe(body)
  })
})
