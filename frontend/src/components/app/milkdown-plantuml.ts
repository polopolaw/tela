import { $ctx, $prose } from '@milkdown/kit/utils'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/ctx'
import { buildPlantumlElement } from '../../lib/diagrams/plantuml'
import { insertBlock } from '../../lib/milkdown/insert-block'

// PlantUML: ```plantuml fence with Kroki-backed preview below the source and a
// full-screen split-pane editor (plantuml-edit-sheet.tsx).

const plantumlKey = new PluginKey('tela-plantuml')

export interface PlantumlOpenRequest {
  code: string
  onSave: (nextCode: string) => void
}

export type PlantumlOpenHandler = (req: PlantumlOpenRequest) => void

export const plantumlOpenCtx = $ctx<PlantumlOpenHandler | null, 'plantumlOpen'>(
  null,
  'plantumlOpen',
)

export const PLANTUML_STARTER = `@startuml
Alice -> Bob: hello
@enduml`

function isPlantumlBlock(node: ProseNode): boolean {
  return (
    node.type.name === 'code_block' &&
    String(node.attrs.language ?? '').toLowerCase() === 'plantuml'
  )
}

function buildPlantumlWidget(code: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'tela-plantuml-wrap'
  wrap.setAttribute('contenteditable', 'false')
  wrap.dataset.plantumlCode = code
  wrap.appendChild(buildPlantumlElement(code))
  const editBtn: HTMLButtonElement = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'tela-plantuml-edit-btn'
  editBtn.contentEditable = 'false'
  editBtn.setAttribute('aria-label', 'Edit diagram')
  editBtn.textContent = 'Edit'
  wrap.appendChild(editBtn)
  return wrap
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!isPlantumlBlock(node)) return
    const code = node.textContent
    if (code.trim().length === 0) return
    decos.push(
      Decoration.widget(pos + node.nodeSize, () => buildPlantumlWidget(code), {
        side: 1,
        key: `plantuml:${code}`,
      }),
    )
  })
  return DecorationSet.create(doc, decos)
}

export const plantumlPlugin = $prose(() => {
  return new Plugin({
    key: plantumlKey,
    props: {
      decorations(state) {
        return buildDecorations(state.doc)
      },
    },
  })
})

function findPlantumlPos(
  doc: ProseNode,
  codeType: ProseNode['type'],
  hintPos: number,
  code: string,
): number {
  let found = -1
  doc.descendants((node, pos) => {
    if (node.type === codeType && isPlantumlBlock(node) && node.textContent === code) {
      if (found === -1 || Math.abs(pos - hintPos) < Math.abs(found - hintPos)) {
        found = pos
      }
    }
  })
  return found
}

export const plantumlClickPlugin = $prose((ctx) => {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click: (view, event) => {
          if (!view.editable) return false
          const targetEl =
            (event.target instanceof Element &&
              event.target.closest('.tela-plantuml-wrap')) ||
            null
          if (!targetEl) return false
          const openCb = ctx.get(plantumlOpenCtx.key)
          if (!openCb) return false

          const clickPos = view.posAtDOM(targetEl, 0)
          if (clickPos < 0) return false
          const $pos = view.state.doc.resolve(clickPos)
          const block = $pos.nodeBefore
          if (!block || !isPlantumlBlock(block)) return false

          const code = block.textContent
          const codeType = block.type
          openCb({
            code,
            onSave: (nextCode) => {
              const writePos = findPlantumlPos(
                view.state.doc,
                codeType,
                clickPos,
                code,
              )
              if (writePos === -1) return
              const nextNode = codeType.create(
                { language: 'plantuml' },
                nextCode ? view.state.schema.text(nextCode) : undefined,
              )
              const tr = view.state.tr.replaceWith(
                writePos,
                writePos + block.nodeSize,
                nextNode,
              )
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

export function insertPlantuml(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx)
  const codeType = view.state.schema.nodes.code_block
  if (!codeType) return
  const openCb = ctx.get(plantumlOpenCtx.key)
  const node = codeType.create(
    { language: 'plantuml' },
    view.state.schema.text(PLANTUML_STARTER),
  )
  insertBlock(view, node, { caret: 'none' })
  if (!openCb) return
  openCb({
    code: PLANTUML_STARTER,
    onSave: (nextCode) => {
      let writePos = -1
      view.state.doc.descendants((n, pos) => {
        if (
          writePos === -1 &&
          isPlantumlBlock(n) &&
          n.textContent === PLANTUML_STARTER
        ) {
          writePos = pos
        }
      })
      if (writePos === -1) return
      const nextNode = codeType.create(
        { language: 'plantuml' },
        view.state.schema.text(nextCode),
      )
      view.dispatch(view.state.tr.replaceWith(writePos, writePos + node.nodeSize, nextNode))
    },
  })
}
