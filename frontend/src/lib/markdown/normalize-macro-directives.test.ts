import { describe, expect, it } from 'vitest'
import { normalizeMacroDirectivesInMarkdown } from './normalize-macro-directives'
import { parsePageMarkdown } from './remark-stack'

describe('normalizeMacroDirectivesInMarkdown', () => {
  it('prefers quoted id over confluence hash on macro-def', () => {
    const body = `:::macro-def{id="m_51aeed39fe" #m_c4bfa2f1c0}
Hello world 1
:::`
    const out = normalizeMacroDirectivesInMarkdown(body)
    expect(out).toContain(':::macro-def{id="m_51aeed39fe"}')
    expect(out).not.toContain('#m_c4bfa2f1c0')

    const tree = parsePageMarkdown(out)
    const def = (tree.children ?? []).find(
      (n) => n.type === 'containerDirective' && n.name === 'macro-def',
    )
    expect(def?.attributes?.id).toBe('m_51aeed39fe')
  })

  it('normalizes hash-only macro refs', () => {
    const body = `:::macro{#m_b9712e3e8e}
:::

:::macro{#m_badc7e45d1}
:::`
    const out = normalizeMacroDirectivesInMarkdown(body)
    expect(out).toContain(':::macro{id="m_b9712e3e8e"}')
    expect(out).toContain(':::macro{id="m_badc7e45d1"}')

    const macros = (parsePageMarkdown(out).children ?? []).filter(
      (n) => n.type === 'containerDirective' && n.name === 'macro',
    )
    expect(macros).toHaveLength(2)
    expect(macros[0].attributes?.id).toBe('m_b9712e3e8e')
    expect(macros[1].attributes?.id).toBe('m_badc7e45d1')
  })

  it('leaves canonical macro syntax unchanged', () => {
    const body = `:::macro{id="m_a"}
:::

:::macro{page=42}
:::`
    expect(normalizeMacroDirectivesInMarkdown(body)).toBe(body)
  })
})
