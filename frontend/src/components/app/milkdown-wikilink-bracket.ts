import { $ctx, $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  wikilinkRemark,
  wikilinkSlug,
  wikilinkHrefHash,
} from '../../lib/markdown/transforms/wikilink'
export { buildWikilinkResolveIndex } from '../../lib/slug'

// `[[Name]]` parsing + slug live in lib/markdown/transforms/wikilink.ts
// (Milkdown-free, shared with the view renderer). This file keeps the editor
// atom schema + resolve/decoration wiring. Re-export the slug for importers.
export { wikilinkSlug }

// Shape of the `wikilink` mdast node (produced by wikilinkRemark) as the
// schema's parseMarkdown runner reads it.
interface MdastWikilink {
  type: string
  target?: unknown
  alias?: unknown
}
import {
  wikilinkModeCtx,
  type WikilinkDecorationMode,
} from './milkdown-wikilink-decoration'

// Obsidian-style `[[Name]]` wikilinks — the bare-bracket sibling of the
// picker-inserted `[Title](tela://page/{id})` link (milkdown-wikilink.tsx).
// Agents and hand-written / synced markdown use `[[Name]]`; before this they
// rendered as inert text. We keep `[[Name]]` as the canonical on-disk form
// (round-trips untouched, so the vault/sync story stays clean) and resolve the
// name → page id only for RENDERING:
//
//   1. `wikilinkBracketRemarkPlugin` — a remark transform that rewrites
//      `[[Name]]` / `[[Name|Alias]]` / `[[Name#Heading]]` text into a custom
//      `wikilink` mdast node on parse, plus a to-markdown handler that re-emits
//      the exact `[[…]]` syntax on save (round-trip).
//   2. `wikilinkBracketSchema` — an inline atom PM node rendering an
//      `<a class="tela-wikilink" data-wikilink-slug="…">label</a>`. No href yet
//      — resolution is reactive (see below).
//   3. `wikilinkResolvePlugin` — a decoration plugin that looks each node's slug
//      up in `wikilinkResolveCtx` (a slug→id map pushed from React) and injects
//      `href="tela://page/{id}"` on the anchor when resolved, or a broken/
//      out-of-scope class when not. Injecting that href is the whole trick: the
//      existing modifier-click handler (editor) and the readers' click handlers
//      already navigate `tela://page/{id}` anchors, so bracket links light up
//      with zero new navigation code.
//
// Resolution mirrors the backend (pages.go resolveWikiTitleSlugs): slug-match a
// page title within the SAME space, lowest id wins — so what the editor renders
// as a live link is exactly what the backend records as a backlink.

// `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]`. Inner text has no
// nested brackets — mirrors the backend wikiBracketRE.

export const wikilinkBracketRemarkPlugin = $remark(
  'telaWikilinkBracket',
  () => wikilinkRemark as never,
)

interface WikilinkSchemaNode {
  attrs: { target: string; alias: string | null }
}

export const wikilinkBracketSchema = $nodeSchema('wikilink', () => ({
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  marks: '',
  attrs: {
    target: { default: '' },
    alias: { default: null },
  },
  parseDOM: [
    {
      tag: 'a[data-wikilink]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          target: el.getAttribute('data-wikilink-target') ?? el.textContent ?? '',
          alias: el.getAttribute('data-wikilink-alias') || null,
        }
      },
    },
  ],
  toDOM: (node) => {
    const { target, alias } = (node as unknown as WikilinkSchemaNode).attrs
    const attrs: Record<string, string> = {
      'data-wikilink': 'true',
      'data-wikilink-slug': wikilinkSlug(target),
      'data-wikilink-target': target,
      class: 'tela-wikilink',
    }
    if (alias) attrs['data-wikilink-alias'] = alias
    return ['a', attrs, alias ?? target]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'wikilink',
    runner: (state, node, type) => {
      const n = node as unknown as MdastWikilink
      state.addNode(type, {
        target: typeof n.target === 'string' ? n.target : '',
        alias: typeof n.alias === 'string' ? n.alias : null,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'wikilink',
    runner: (state, node) => {
      state.addNode('wikilink', undefined, undefined, {
        target: node.attrs.target,
        alias: node.attrs.alias,
      })
    },
  },
}))

// ---- resolution (reactive decoration) --------------------------------------

// Slug→id map for the active page's space. `null` = the React side hasn't pushed
// a snapshot yet → render nothing extra (links stay neutral, not redlined) until
// it lands. Mirrors the wikilinkAliveIdsCtx "don't know yet" convention.
export const wikilinkResolveCtx = $ctx<Map<string, number> | null, 'wikilinkResolve'>(
  null,
  'wikilinkResolve',
)

// Dispatched by the React side after swapping the slice so the plugin rebuilds
// without waiting for the next keystroke (same mechanism as the alive-ids meta).
export const WIKILINK_RESOLVE_META = 'tela-wikilink-resolve'

interface ResolveState {
  decos: DecorationSet
}

function buildResolveDecorations(
  doc: ProseNode,
  index: Map<string, number> | null,
  mode: WikilinkDecorationMode,
): DecorationSet {
  if (index == null) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'wikilink') return
    const slug = wikilinkSlug(node.attrs.target as string)
    const id = slug ? index.get(slug) : undefined
    if (id != null) {
      const hash = wikilinkHrefHash(node.attrs.target as string)
      // Inject the canonical href — existing modifier-click + reader click
      // handlers take it from here.
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          href: `tela://page/${id}${hash}`,
        }),
      )
    } else {
      // Out-of-scope share links render as plain text (no leak); everywhere
      // else an unresolved name is a broken link.
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class:
            mode === 'share'
              ? 'tela-wikilink--share-out-of-scope'
              : 'tela-wikilink--broken',
        }),
      )
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

export const wikilinkResolvePlugin = $prose((ctx) => {
  return new Plugin<ResolveState>({
    state: {
      init: (_, { doc }) => ({
        decos: buildResolveDecorations(
          doc,
          ctx.get(wikilinkResolveCtx.key),
          ctx.get(wikilinkModeCtx.key),
        ),
      }),
      apply: (tr, old) => {
        const changed = tr.getMeta(WIKILINK_RESOLVE_META) === true
        if (!tr.docChanged && !changed) return old
        return {
          decos: buildResolveDecorations(
            tr.doc,
            ctx.get(wikilinkResolveCtx.key),
            ctx.get(wikilinkModeCtx.key),
          ),
        }
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decos
      },
    },
  })
})
