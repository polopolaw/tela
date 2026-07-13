import { findAndReplace } from 'mdast-util-find-and-replace'
import { pageSlug } from '../../slug'
import { headingHashFromFragment } from '../../reader/heading-anchors'

// Pure, Milkdown-free `[[Name]]` / `[[Name|alias]]` parsing. SINGLE SOURCE
// shared by the Milkdown editor (milkdown-wikilink-bracket.ts wraps this in
// `$remark` + builds the atom schema) and the view renderer's parser
// (lib/markdown/remark-stack.ts). See docs/view-edit-split.md.

// Non-greedy, no nested brackets — mirrors the backend wikiBracketRE.
const BRACKET_RE = /\[\[([^[\]]+?)\]\]/g

interface WikilinkParts {
  target: string
  alias: string | null
}

// Split the inner text into target + optional display alias. The alias (after
// `|`) is display-only; a `#heading` suffix stays inside target.
export function splitWikilink(inner: string): WikilinkParts {
  const bar = inner.indexOf('|')
  if (bar >= 0) {
    const alias = inner.slice(bar + 1).trim()
    return { target: inner.slice(0, bar).trim(), alias: alias.length > 0 ? alias : null }
  }
  return { target: inner.trim(), alias: null }
}

// Page title part of a wikilink target (strips optional `#heading` suffix).
export function wikilinkPageTitle(target: string): string {
  const hash = target.indexOf('#')
  return (hash >= 0 ? target.slice(0, hash) : target).trim()
}

// Optional `#heading` fragment from a wikilink target (raw text, not slugified).
export function wikilinkFragment(target: string): string | null {
  const hash = target.indexOf('#')
  if (hash < 0) return null
  const frag = target.slice(hash + 1).trim()
  return frag || null
}

// Slug used for resolution: drop any `#heading`, then slugify the title exactly
// as the backend does (parity with pageSlug → resolveWikiTitleSlugs).
export function wikilinkSlug(target: string): string {
  return pageSlug(wikilinkPageTitle(target))
}

export function wikilinkHrefHash(target: string): string {
  const frag = wikilinkFragment(target)
  if (!frag) return ''
  const slug = headingHashFromFragment(frag)
  return slug ? `#${slug}` : ''
}

/** Parse `tela://page/{id}` or `tela://page/{id}#{fragment}` hrefs. */
export function parseTelaPageHref(
  href: string,
): { pageId: number; hash?: string } | null {
  const prefix = 'tela://page/'
  if (!href.startsWith(prefix)) return null
  const rest = href.slice(prefix.length)
  const hashIdx = rest.indexOf('#')
  const idPart = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest
  if (!/^\d+$/.test(idPart)) return null
  const pageId = Number(idPart)
  if (hashIdx < 0) return { pageId }
  const raw = rest.slice(hashIdx + 1)
  if (!raw) return { pageId }
  try {
    return { pageId, hash: decodeURIComponent(raw) }
  } catch {
    return { pageId, hash: raw }
  }
}

/** Parse in-app page href `/spaces/.../pages/{id}[/{slug}][#fragment]`. */
export function parseAppPageHref(
  href: string,
): { pageId: number; hash?: string } | null {
  try {
    const u = new URL(href, window.location.origin)
    const m = u.pathname.match(/\/spaces\/\d+\/pages\/(\d+)/)
    if (!m) return null
    const pageId = Number(m[1])
    const hash = u.hash ? decodeURIComponent(u.hash.slice(1)) : undefined
    return hash ? { pageId, hash } : { pageId }
  } catch {
    return null
  }
}

interface MdastWikilink {
  type: 'wikilink'
  target: string
  alias: string | null
}

// Regular function so unified binds `this` to the processor, letting us register
// the to-markdown handler for our custom `wikilink` node. Typed loosely.
export function wikilinkRemark(this: { data: () => Record<string, unknown> }) {
  const data = this.data()
  const toMarkdownExtensions = (data.toMarkdownExtensions ||
    (data.toMarkdownExtensions = [])) as Array<{ handlers: Record<string, unknown> }>
  toMarkdownExtensions.push({
    handlers: {
      wikilink: (node: MdastWikilink) =>
        node.alias ? `[[${node.target}|${node.alias}]]` : `[[${node.target}]]`,
    },
  })
  return (tree: unknown) => {
    findAndReplace(tree as never, [
      [
        BRACKET_RE,
        (_full: string, inner: string) => {
          const { target, alias } = splitWikilink(inner)
          // `[[ ]]` / `[[|x]]` — nothing to link; leave the literal text.
          if (target === '') return false as never
          return { type: 'wikilink', target, alias } as never
        },
      ],
    ])
  }
}
