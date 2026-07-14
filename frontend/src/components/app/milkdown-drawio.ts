import { $ctx, $nodeSchema, $prose, $remark } from '@milkdown/kit/utils'
import { Plugin } from '@milkdown/kit/prose/state'
import type { Ctx } from '@milkdown/ctx'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  drawioRemark,
  DRAWIO_EMPTY_SCENE_JSON,
  type MdastNode,
} from '../../lib/markdown/transforms/drawio'
import { newDiagramId, pageIdCtx } from './milkdown-excalidraw'

export interface DrawioOpenRequest {
  sceneHash: string
  altText: string
  sceneJSON: string
  diagramId: string
  initialXml: string
  onSave: (next: {
    sceneHash: string
    altText: string
    sceneJSON: string
    diagramId: string
  }) => void
}
export type DrawioOpenHandler = (req: DrawioOpenRequest) => void

export const drawioOpenCtx = $ctx<DrawioOpenHandler | null, 'drawioOpen'>(
  null,
  'drawioOpen',
)

export type DrawioInsertHandler = () => void
export const drawioInsertOpenCtx = $ctx<DrawioInsertHandler | null, 'drawioInsertOpen'>(
  null,
  'drawioInsertOpen',
)

export const drawioRemarkPlugin = $remark('telaDrawio', () => drawioRemark)

interface DrawioSchemaNode {
  attrs: { sceneHash: string; altText: string; sceneJSON: string; diagramId: string }
}

interface PMNodeLike {
  type: unknown
  attrs: { diagramId?: string; [k: string]: unknown }
}

function parseXmlFromSceneJSON(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { xml?: unknown }
    return typeof parsed.xml === 'string' ? parsed.xml : ''
  } catch {
    return ''
  }
}

function findDrawioPos(
  doc: {
    descendants: (f: (node: PMNodeLike, pos: number) => boolean) => void
    nodeAt: (pos: number) => PMNodeLike | null
  },
  drawioType: unknown,
  diagramId: string,
  fallbackPos: number,
): number {
  if (diagramId) {
    let found = -1
    doc.descendants((node, pos) => {
      if (found !== -1) return false
      if (node.type === drawioType && node.attrs.diagramId === diagramId) {
        found = pos
        return false
      }
      return true
    })
    if (found !== -1) return found
  }
  const at = doc.nodeAt(fallbackPos)
  if (at && at.type === drawioType) return fallbackPos
  return -1
}

export const drawioSchema = $nodeSchema('drawio', (ctx) => ({
  group: 'block',
  atom: true,
  defining: true,
  draggable: true,
  selectable: true,
  isolating: true,
  marks: '',
  attrs: {
    sceneHash: { default: '' },
    altText: { default: '' },
    sceneJSON: { default: '' },
    diagramId: { default: '' },
  },
  parseDOM: [
    {
      tag: 'div.tela-drawio[data-scene-hash]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement
        return {
          sceneHash: el.getAttribute('data-scene-hash') ?? '',
          altText: el.getAttribute('data-alt-text') ?? '',
          sceneJSON: el.getAttribute('data-scene-json') ?? '',
          diagramId: el.getAttribute('data-diagram-id') ?? '',
        }
      },
    },
  ],
  toDOM: (node) => {
    const { sceneHash, altText, sceneJSON, diagramId } = (node as unknown as DrawioSchemaNode)
      .attrs
    const pageId = ctx.get(pageIdCtx.key)
    const editBtn: ['button', Record<string, string>, string] = [
      'button',
      {
        type: 'button',
        class: 'tela-drawio-edit-btn',
        contenteditable: 'false',
        'aria-label': 'Edit diagram',
      },
      'Edit',
    ]
    if (!sceneHash) {
      return [
        'div',
        {
          class: 'tela-drawio tela-drawio--empty',
          'data-scene-hash': '',
          'data-alt-text': altText,
          'data-scene-json': sceneJSON,
          'data-diagram-id': diagramId,
        },
        ['span', { class: 'tela-drawio-empty-label' }, '[Empty diagram — click to edit]'],
        editBtn,
      ]
    }
    return [
      'div',
      {
        class: 'tela-drawio',
        'data-scene-hash': sceneHash,
        'data-alt-text': altText,
        'data-scene-json': sceneJSON,
        'data-diagram-id': diagramId,
      },
      [
        'img',
        {
          src: `/api/diagrams/${pageId}/${sceneHash}.png`,
          alt: altText || 'Draw.io diagram',
          loading: 'lazy',
        },
      ],
      editBtn,
    ]
  },
  parseMarkdown: {
    match: ({ type }) => type === 'drawio',
    runner: (state, node, type) => {
      const n = node as MdastNode
      state.addNode(type, {
        sceneHash: typeof n.sceneHash === 'string' ? n.sceneHash : '',
        altText: typeof n.altText === 'string' ? n.altText : '',
        diagramId: typeof n.diagramId === 'string' ? n.diagramId : '',
        sceneJSON:
          typeof n.sceneJSON === 'string' && n.sceneJSON.length > 0
            ? n.sceneJSON
            : DRAWIO_EMPTY_SCENE_JSON,
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'drawio',
    runner: (state, node) => {
      const sceneJSON =
        typeof node.attrs.sceneJSON === 'string' && node.attrs.sceneJSON.length > 0
          ? (node.attrs.sceneJSON as string)
          : DRAWIO_EMPTY_SCENE_JSON
      state.addNode('code', undefined, sceneJSON, { lang: 'drawio' })
    },
  },
}))

export const drawioClickPlugin = $prose((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click: (view, event) => {
          if (!view.editable) return false
          const targetEl =
            (event.target instanceof Element && event.target.closest('.tela-drawio')) || null
          if (!targetEl) return false
          const openCb = ctx.get(drawioOpenCtx.key)
          if (!openCb) return false

          const pos = view.posAtDOM(targetEl, 0)
          if (pos < 0) return false
          const node = view.state.doc.nodeAt(pos)
          if (!node || node.type.name !== 'drawio') return false

          const sceneHash = typeof node.attrs.sceneHash === 'string' ? node.attrs.sceneHash : ''
          const altText = typeof node.attrs.altText === 'string' ? node.attrs.altText : ''
          const sceneJSON = typeof node.attrs.sceneJSON === 'string' ? node.attrs.sceneJSON : ''
          const diagramId = typeof node.attrs.diagramId === 'string' ? node.attrs.diagramId : ''

          openCb({
            sceneHash,
            altText,
            sceneJSON,
            diagramId,
            initialXml: parseXmlFromSceneJSON(sceneJSON),
            onSave: (next) => {
              const writePos = findDrawioPos(
                view.state.doc as never,
                node.type,
                diagramId,
                pos,
              )
              if (writePos === -1) return
              const tr = view.state.tr.setNodeMarkup(writePos, undefined, {
                sceneHash: next.sceneHash,
                altText: next.altText,
                sceneJSON: next.sceneJSON,
                diagramId: next.diagramId,
              })
              view.dispatch(tr)
            },
          })
          event.preventDefault()
          return true
        },
      },
    },
  })
})

function insertDrawioAtom(
  ctx: Ctx,
  opts: { xml: string; openSheet: boolean },
): void {
  const view = ctx.get(editorViewCtx)
  const { state } = view
  const drawioType = state.schema.nodes.drawio
  if (!drawioType) return
  const openCb = ctx.get(drawioOpenCtx.key)

  const diagramId = newDiagramId()
  const sceneJSON = JSON.stringify({
    scene_hash: '',
    alt_text: '',
    diagram_id: diagramId,
    xml: opts.xml,
  })
  const atom = drawioType.create({
    sceneHash: '',
    altText: '',
    sceneJSON,
    diagramId,
  })
  const tr = state.tr.replaceSelectionWith(atom)
  let insertedPos = -1
  tr.doc.descendants((node, pos) => {
    if (node.type === drawioType && node.attrs.diagramId === diagramId) {
      insertedPos = pos
    }
    return true
  })
  if (insertedPos !== -1) {
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertedPos + atom.nodeSize)))
  }
  view.dispatch(tr.scrollIntoView())

  if (insertedPos !== -1 && opts.openSheet && openCb) {
    openCb({
      sceneHash: '',
      altText: '',
      sceneJSON,
      diagramId,
      initialXml: opts.xml,
      onSave: (next) => {
        const v = ctx.get(editorViewCtx)
        const writePos = findDrawioPos(v.state.doc as never, drawioType, diagramId, insertedPos)
        if (writePos === -1) return
        const tr2 = v.state.tr.setNodeMarkup(writePos, undefined, {
          sceneHash: next.sceneHash,
          altText: next.altText,
          sceneJSON: next.sceneJSON,
          diagramId: next.diagramId,
        })
        v.dispatch(tr2)
      },
    })
  }
}

export function insertDrawio(ctx: Ctx): void {
  const openInsert = ctx.get(drawioInsertOpenCtx.key)
  if (openInsert) {
    openInsert()
    return
  }
  insertDrawioAtom(ctx, { xml: '', openSheet: true })
}

export function insertDrawioWithXml(ctx: Ctx, xml: string): void {
  insertDrawioAtom(ctx, { xml, openSheet: true })
}
