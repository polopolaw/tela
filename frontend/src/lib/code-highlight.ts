import type { ReactNode } from 'react'
import { createElement } from 'react'
import type { Refractor } from 'refractor/core'
import { refractor } from 'refractor/core'
import { configureRefractor } from './milkdown/refractor-config'

/** Common fence labels → refractor grammar id. */
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  jsonc: 'json',
  golang: 'go',
  rs: 'rust',
  rb: 'ruby',
  plaintext: 'text',
  plain: 'text',
}

/** Curated set — keep in sync with refractor-config.ts. */
export const CODE_LANGUAGES = [
  'text',
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'bash',
  'sql',
  'json',
  'yaml',
  'toml',
  'css',
  'scss',
  'markdown',
  'diff',
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]

let refractorReady = false

export function ensureCodeRefractor(): Refractor {
  if (!refractorReady) {
    configureRefractor(refractor)
    refractorReady = true
  }
  return refractor
}

/** Normalize a fence info string to a refractor id, or null for plain text. */
export function normalizeCodeLang(lang: string | null | undefined): string | null {
  if (lang == null) return null
  const raw = lang.trim().toLowerCase()
  if (!raw || raw === 'text') return null
  return LANG_ALIASES[raw] ?? raw
}

/** Best-effort language guess when the fence has no info string. */
export function guessCodeLang(code: string): string | null {
  const s = code.trim()
  if (!s) return null

  if (s.startsWith('#!')) {
    if (/python/.test(s)) return 'python'
    if (/bash|sh/.test(s)) return 'bash'
    if (/node/.test(s)) return 'javascript'
  }

  if (
    ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) &&
    s.includes('"')
  ) {
    try {
      JSON.parse(s)
      return 'json'
    } catch {
      /* not json */
    }
  }

  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\s/im.test(s)) return 'sql'
  if (/^\s*package\s+\w+/m.test(s)) return 'go'
  if (/^\s*(fn |use |impl |pub fn|mod )/m.test(s)) return 'rust'
  if (/^<\?php/.test(s)) return 'php'
  if (/^diff --git/m.test(s) || /^@@\s[-\d+,]+/m.test(s)) return 'diff'
  if (/^---\s*\n[\w-]+:/m.test(s)) return 'yaml'
  if (/^<\/?[a-zA-Z][\w:-]*/.test(s)) return 'markup'
  if (/^[@.#][\w-]+\s*\{/.test(s) || /^[\w-]+\s*:\s*[^;{]+;/m.test(s)) return 'css'
  if (/\b(import|export)\s+.+from\s+['"]/m.test(s)) return 'typescript'
  if (/<[A-Z][\w]*[\s/>]/.test(s)) return 'tsx'
  if (/\b(interface|type)\s+\w+/.test(s)) return 'typescript'
  if (/\b(const|let|var|function)\b/.test(s)) return 'javascript'
  if (/^\s*(def |class )/m.test(s)) return 'python'
  if (/^\s*from [\w.]+\s+import/m.test(s)) return 'python'
  if (/^\s*import \w+/m.test(s)) return 'python'
  if (/^\$\s/.test(s) || /^(npm|yarn|pnpm|make|docker|kubectl|curl|git|cd|sudo)\s/m.test(s))
    return 'bash'

  return null
}

/** Normalize an explicit fence label, else guess from body when empty. */
export function resolveCodeLang(
  code: string,
  lang: string | null | undefined,
  r: Refractor = ensureCodeRefractor(),
): string | null {
  const normalized = normalizeCodeLang(lang)
  if (normalized && r.registered(normalized)) return normalized
  const guessed = guessCodeLang(code)
  if (guessed && r.registered(guessed)) return guessed
  return null
}

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function renderHast(node: HastNode, key: number): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type === 'element' && node.tagName) {
    const cls = node.properties?.className
    const className = Array.isArray(cls)
      ? cls.join(' ')
      : typeof cls === 'string'
        ? cls
        : undefined
    return createElement(
      node.tagName,
      { key, className },
      node.children?.map((c, i) => renderHast(c, i)),
    )
  }
  return null
}

/** Highlight `code` with `lang` (explicit or guessed) → React children for <code>. */
export function highlightCodeChildren(
  code: string,
  lang: string | null | undefined,
  r: Refractor = ensureCodeRefractor(),
): { lang: string | null; children: ReactNode } {
  const resolved = resolveCodeLang(code, lang, r)
  if (!resolved) return { lang: null, children: code }
  try {
    const tree = r.highlight(code, resolved) as unknown as HastNode
    return {
      lang: resolved,
      children: tree.children?.map((c, i) => renderHast(c, i)) ?? code,
    }
  } catch {
    return { lang: resolved, children: code }
  }
}
