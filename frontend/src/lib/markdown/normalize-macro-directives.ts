/** Extract id="…" / id='…' from a directive attribute block (before remark-directive runs). */
function quotedAttrValue(inner: string, key: string): string {
  const re = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
  const m = inner.match(re)
  return (m?.[1] ?? m?.[2] ?? '').trim()
}

/** Confluence import emits a bare #m_… token; remark-directive treats it as id. */
function hashMacroId(inner: string): string {
  const m = inner.match(/#(m_[a-zA-Z0-9_]+)/)
  return m?.[1] ?? ''
}

function pageAttrValue(inner: string): string {
  const m = inner.match(/\bpage\s*=\s*(?:"?(\d+)"?)/)
  return m?.[1] ?? ''
}

function normalizeMacroOpenLine(line: string): string {
  const trimmed = line.trimStart()
  let name: 'macro-def' | 'macro' | null = null
  if (trimmed.startsWith(':::macro-def')) name = 'macro-def'
  else if (trimmed.startsWith(':::macro') && !trimmed.startsWith(':::macro-def')) name = 'macro'
  if (!name) return line

  const lead = line.slice(0, line.length - trimmed.length)
  const openBrace = trimmed.indexOf('{')
  const closeBrace = trimmed.lastIndexOf('}')
  if (openBrace < 0 || closeBrace <= openBrace) return line

  const inner = trimmed.slice(openBrace + 1, closeBrace)
  const tail = trimmed.slice(closeBrace + 1)
  const quotedId = quotedAttrValue(inner, 'id')
  const hashId = hashMacroId(inner)
  const canonicalId = quotedId || hashId
  const pageId = pageAttrValue(inner)

  if (name === 'macro-def') {
    if (!canonicalId) return line
    return `${lead}:::macro-def{id="${canonicalId}"}${tail}`
  }

  if (pageId) return `${lead}:::macro{page=${pageId}}${tail}`
  if (!canonicalId) return line
  return `${lead}:::macro{id="${canonicalId}"}${tail}`
}

/**
 * Rewrite macro / macro-def openers so quoted id="m_…" wins over a trailing
 * Confluence #m_… hash. remark-directive prefers the hash otherwise, which
 * desyncs the editor from page_macros and breaks live includes on save.
 */
export function normalizeMacroDirectivesInMarkdown(body: string): string {
  const nl = body.includes('\r\n') ? '\r\n' : '\n'
  const lines = body.split(nl)
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t.startsWith(':::macro-def') && !t.startsWith(':::macro')) continue
    const next = normalizeMacroOpenLine(lines[i])
    if (next !== lines[i]) {
      lines[i] = next
      changed = true
    }
  }
  return changed ? lines.join(nl) : body
}
