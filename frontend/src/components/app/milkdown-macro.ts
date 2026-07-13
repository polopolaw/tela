import { $ctx, $nodeSchema } from '@milkdown/kit/utils'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/ctx'
import { Plugin } from '@milkdown/kit/prose/state'
import type { Transaction } from '@milkdown/kit/prose/state'
import { insertBlock } from '../../lib/milkdown/insert-block'
import { newMacroId } from '../../lib/queries/macros'

interface MdastNode {
  type: string
  name?: string
  attributes?: Record<string, string | null | undefined>
  children?: MdastNode[]
}

function ensureMacroId(raw: string | undefined | null): string {
  const id = (raw ?? '').trim()
  return id || newMacroId()
}

// Stamp missing ids before serialize/save — macro-def without {id=} 400s on PATCH.
export const ensureMacroDefIdsPlugin = new Plugin({
  appendTransaction(_transactions, _oldState, newState) {
    let tr: Transaction | null = null
    newState.doc.descendants((node, pos) => {
      if (node.type.name !== 'macro_def') return
      if ((node.attrs.macroId as string)?.trim()) return
      tr ??= newState.tr
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, macroId: newMacroId() })
    })
    return tr
  },
})

// macro-def: reusable source block on a page (`:::macro-def{id=…}` … `:::`).
export const macroDefSchema = $nodeSchema('macro_def', () => ({
  group: 'block',
  content: 'block+',
  defining: true,
  attrs: {
    macroId: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'div[data-macro-def]',
      getAttrs: (dom) => ({
        macroId: dom instanceof HTMLElement ? (dom.dataset.macroId ?? '') : '',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-macro-def': '',
      'data-macro-id': node.attrs.macroId,
      class: 'tela-macro-def',
    },
    0,
  ],
  parseMarkdown: {
    match: (node) =>
      node.type === 'containerDirective' && (node as MdastNode).name === 'macro-def',
    runner: (state, node, type) => {
      const attrs = (node as MdastNode).attributes ?? {}
      const macroId = ensureMacroId(attrs.id)
      const children = (node as MdastNode).children ?? []
      state.openNode(type, { macroId })
      if (children.length > 0) {
        state.next(children as never)
      } else {
        const paraType = type.schema.nodes.paragraph
        if (paraType) {
          state.openNode(paraType)
          state.closeNode()
        }
      }
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'macro_def',
    runner: (state, node) => {
      const macroId = ensureMacroId(node.attrs.macroId as string)
      state.openNode('containerDirective', undefined, {
        name: 'macro-def',
        attributes: { id: macroId },
      })
      state.next(node.content)
      state.closeNode()
    },
  },
}))

// macro: live include reference — block id or whole page (`:::macro{id=…}` / `{page=…}`).
export const macroRefSchema = $nodeSchema('macro_ref', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    macroId: { default: '', validate: 'string' },
    pageId: { default: '', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'div[data-macro-ref]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return {}
        return {
          macroId: dom.dataset.macroId ?? '',
          pageId: dom.dataset.pageId ?? '',
        }
      },
    },
  ],
  toDOM: (node) => {
    const macroId = (node.attrs.macroId as string) || ''
    const pageId = (node.attrs.pageId as string) || ''
    const label = macroId
      ? `Macro: ${macroId}`
      : pageId
        ? `Page include: ${pageId}`
        : 'Macro insert'
    return [
      'div',
      {
        'data-macro-ref': '',
        'data-macro-id': macroId,
        'data-page-id': pageId,
        class: 'tela-macro-ref',
        contenteditable: 'false',
      },
      ['span', { class: 'tela-macro-ref-label' }, `↗ ${label}`],
      ['span', { class: 'tela-macro-ref-badge' }, 'live'],
    ]
  },
  parseMarkdown: {
    match: (node) =>
      node.type === 'containerDirective' && (node as MdastNode).name === 'macro',
    runner: (state, node, type) => {
      const attrs = (node as MdastNode).attributes ?? {}
      state.addNode(type, {
        macroId: attrs.id ?? '',
        pageId: attrs.page ?? '',
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'macro_ref',
    runner: (state, node) => {
      const attributes: Record<string, string> = {}
      const macroId = (node.attrs.macroId as string) || ''
      const pageId = (node.attrs.pageId as string) || ''
      if (macroId) attributes.id = macroId
      if (pageId) attributes.page = pageId
      state.openNode('containerDirective', undefined, {
        name: 'macro',
        attributes,
      })
      state.closeNode()
    },
  },
}))

export function insertMacroDef(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { state } = view
  if (!state.selection.empty) {
    wrapSelectionInMacroDef(ctx)
    return
  }
  const { schema } = view.state
  const macroDefType = schema.nodes.macro_def
  const paraType = schema.nodes.paragraph
  if (!macroDefType || !paraType) return
  const macroId = newMacroId()
  const node = macroDefType.create({ macroId }, [
    paraType.create(null, schema.text('Reusable content — edit here, insert elsewhere.')),
  ])
  insertBlock(view, node, { caret: 'inside' })
}

export function insertMacroRef(ctx: Ctx) {
  openMacroPicker(ctx)
}

// ── Macro include picker (slash / bubble) ─────────────────────────────────────

export interface MacroPickerRequest {
  anchor: { left: number; top: number; bottom: number }
  pos: number
}
export type MacroPickerOpenHandler = (req: MacroPickerRequest) => void

export const macroPickerOpenCtx = $ctx<MacroPickerOpenHandler | null, 'macroPickerOpen'>(
  null,
  'macroPickerOpen',
)

export function openMacroPicker(ctx: Ctx) {
  const handler = ctx.get(macroPickerOpenCtx.key)
  if (!handler) return
  const view = ctx.get(editorViewCtx)
  const { from } = view.state.selection
  const coords = view.coordsAtPos(from)
  handler({
    pos: from,
    anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
  })
}

export function insertMacroRefAt(
  ctx: Ctx,
  pos: number,
  sel: { macroId?: string; pageId?: number },
) {
  const view = ctx.get(editorViewCtx)
  const macroRefType = view.state.schema.nodes.macro_ref
  if (!macroRefType) return
  const at = Math.min(pos, view.state.doc.content.size)
  const node =
    sel.pageId != null && sel.pageId > 0
      ? macroRefType.create({ pageId: String(sel.pageId) })
      : macroRefType.create({ macroId: sel.macroId ?? '' })
  const tr = view.state.tr.replaceWith(at, at, node)
  view.dispatch(tr.scrollIntoView())
  view.focus()
}

// Wrap the current selection in a new macro-def (bubble toolbar / slash menu).
export function wrapSelectionInMacroDef(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { state } = view
  const { from, to } = state.selection
  if (from === to) return
  const macroDefType = state.schema.nodes.macro_def
  const paraType = state.schema.nodes.paragraph
  if (!macroDefType) return
  const macroId = newMacroId()
  const $from = state.doc.resolve(from)
  const $to = state.doc.resolve(to)
  const range = $from.blockRange($to)
  if (range) {
    const tr = state.tr.wrap(range, [{ type: macroDefType, attrs: { macroId } }])
    view.dispatch(tr.scrollIntoView())
    view.focus()
    return
  }
  // Inline-only selection: one paragraph scaffold inside the macro.
  if (!paraType) return
  const text = state.doc.textBetween(from, to)
  const para = paraType.create(
    null,
    text ? state.schema.text(text) : undefined,
  )
  const node = macroDefType.create({ macroId }, para)
  view.dispatch(state.tr.replaceRangeWith(from, to, node).scrollIntoView())
  view.focus()
}
