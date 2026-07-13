import { newMacroId } from '../queries/macros'

function attrValue(line: string, key: string): string {
  const l = line.indexOf('{')
  const r = line.lastIndexOf('}')
  if (l < 0 || r <= l) return ''
  const inner = line.slice(l + 1, r)
  for (const tok of inner.split(/\s+/)) {
    if (!tok.startsWith(`${key}=`)) continue
    return tok.slice(key.length + 1).replace(/^["']|["']$/g, '')
  }
  return ''
}

function stampOpenLine(line: string, id: string): string {
  const m = line.match(/^(\s*):::macro-def(.*)$/)
  if (!m) return line
  const lead = m[1]
  const rest = m[2]
  if (rest.startsWith('{')) {
    const r = rest.lastIndexOf('}')
    if (r >= 0) {
      const inner = rest.slice(1, r).trim()
      const newInner = inner ? `id="${id}" ${inner}` : `id="${id}"`
      return `${lead}:::macro-def{${newInner}}${rest.slice(r + 1)}`
    }
  }
  return `${lead}:::macro-def{id="${id}"}${rest}`
}

/** Ensure every `:::macro-def` opener in canonical markdown carries `{id=…}`. */
export function stampMacroDefIdsInMarkdown(body: string): string {
  const nl = body.includes('\r\n') ? '\r\n' : '\n'
  const lines = body.split(nl)
  let changed = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (!t.startsWith(':::macro-def')) continue
    if (attrValue(t, 'id')) continue
    lines[i] = stampOpenLine(lines[i], newMacroId())
    changed = true
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === ':::') {
        i = j
        break
      }
    }
  }
  return changed ? lines.join(nl) : body
}
