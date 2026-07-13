import { $command, $prose } from '@milkdown/kit/utils'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { Schema } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import {
  addColAfterCommand,
  addRowAfterCommand,
} from '@milkdown/kit/preset/gfm'
import {
  addColumn,
  findTable,
  isInTable,
  selectedRect,
  selectionCell,
  TableMap,
  toggleHeaderRow,
} from '@milkdown/kit/prose/tables'
import {
  enhanceReadonlyTable,
  enhanceReadonlyTablesInRoot,
  glyphFor,
} from '../../lib/blocks/table'

// Re-export read-mode helpers for hosts (MarkdownView, ReaderShell, Storybook).
export { enhanceReadonlyTable, enhanceReadonlyTablesInRoot, glyphFor }

const tableKey = new PluginKey('tela-table-enhance')

function isSubheaderRowNode(row: ProseNode): boolean {
  if (row.type.name !== 'table_row') return false
  let anyContent = false
  for (let i = 0; i < row.childCount; i++) {
    const cell = row.child(i)
    const text = cell.textContent.trim()
    if (text) anyContent = true
    if (!cellIsAllBold(cell)) return false
  }
  return anyContent
}

function cellIsAllBold(cell: ProseNode): boolean {
  if (cell.childCount === 0) return true
  for (let i = 0; i < cell.childCount; i++) {
    const block = cell.child(i)
    if (block.type.name !== 'paragraph') return false
    if (block.childCount === 0) continue
    for (let j = 0; j < block.childCount; j++) {
      const inline = block.child(j)
      if (inline.type.name === 'hard_break') continue
      const strong = inline.marks.some((m) => m.type.name === 'strong')
      if (!strong && inline.textContent.trim()) return false
    }
  }
  return true
}

function buildDecorations(doc: ProseNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    node.forEach((row, rowOffset) => {
      if (row.type.name !== 'table_row') return
      const rowPos = pos + 1 + rowOffset
      if (isSubheaderRowNode(row)) {
        decos.push(
          Decoration.node(rowPos, rowPos + row.nodeSize, {
            class: 'tela-table-subheader-row',
          }),
        )
      }
      row.forEach((cell, cellOffset) => {
        const cellPos = rowPos + 1 + cellOffset
        const g = glyphFor(cell.textContent)
        if (g) {
          decos.push(
            Decoration.node(cellPos, cellPos + cell.nodeSize, {
              class: `tela-cell-glyph tela-cell-glyph-${g}`,
            }),
          )
        }
      })
    })
    return false
  })
  return DecorationSet.create(doc, decos)
}

function replaceCellContent(
  tr: Transaction,
  cellPos: number,
  text: string,
  schema: Schema,
) {
  const cell = tr.doc.nodeAt(cellPos)
  if (!cell) return tr
  const inner = cellPos + 1
  const para = schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : null,
  )
  return tr.replaceWith(inner, inner + cell.content.size, para)
}

export const insertNumberedColumnCommand = $command(
  'InsertNumberedColumn',
  () => () => (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    let tr = state.tr
    tr = addColumn(tr, rect, 0)
    const table = tr.doc.nodeAt(rect.tableStart)
    if (!table) return false
    const map = TableMap.get(table)
    for (let row = 0; row < map.height; row++) {
      const offset = map.positionAt(row, 0, table)
      const cellPos = rect.tableStart + 1 + offset
      const value = row === 0 ? '№' : String(row)
      tr = replaceCellContent(tr, cellPos, value, state.schema)
    }
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  },
)

export const toggleSubheaderRowCommand = $command(
  'ToggleSubheaderRow',
  () => () => (state, dispatch) => {
    if (!isInTable(state)) return false
    const $cell = selectionCell(state)
    const table = findTable($cell)
    if (!table) return false
    const map = TableMap.get(table.node)
    const cellRect = map.findCell($cell.pos - table.start - 1)
    const row = table.node.child(cellRect.top)
    const already = isSubheaderRowNode(row)
    const strong = state.schema.marks.strong
    if (!strong) return false

    let tr = state.tr
    for (let c = cellRect.left; c < cellRect.right; c++) {
      const offset = map.positionAt(cellRect.top, c, table.node)
      const cellPos = table.start + 1 + offset
      const cell = tr.doc.nodeAt(cellPos)
      if (!cell) continue
      const innerFrom = cellPos + 1
      const innerTo = cellPos + cell.nodeSize - 1
      if (already) {
        tr = tr.removeMark(innerFrom, innerTo, strong)
      } else {
        const text = cell.textContent.trim()
        if (text) {
          const para = state.schema.nodes.paragraph.create(
            null,
            state.schema.text(text, [strong.create()]),
          )
          tr = tr.replaceWith(innerFrom, innerTo, para)
        }
      }
    }
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  },
)

export const toggleTableHeaderRowCommand = $command(
  'ToggleTableHeaderRow',
  () => () => (state, dispatch) => toggleHeaderRow(state, dispatch),
)

function runCmd(ctx: import('@milkdown/ctx').Ctx, cmd: typeof addColAfterCommand) {
  ctx.get(commandsCtx).call(cmd.key)
}

function focusTableWrapper(
  wrapper: HTMLElement,
  ctx: import('@milkdown/ctx').Ctx,
) {
  const view = ctx.get(editorViewCtx)
  const table = wrapper.querySelector('table')
  if (!table) return
  try {
    const pos = view.posAtDOM(table, 0) + 1
    const sel = TextSelection.near(view.state.doc.resolve(pos), 1)
    view.dispatch(view.state.tr.setSelection(sel))
  } catch {
    // posAtDOM can throw if the table node was just replaced — skip focus.
  }
}

function attachHoverButtons(
  wrapper: HTMLElement,
  ctx: import('@milkdown/ctx').Ctx,
) {
  if (wrapper.dataset.telaHoverBtns) return
  wrapper.dataset.telaHoverBtns = '1'
  wrapper.classList.add('tela-table-wrapper-enhanced')

  const addCol = document.createElement('button')
  addCol.type = 'button'
  addCol.className = 'tela-table-add-col'
  addCol.setAttribute('aria-label', 'Add column')
  addCol.textContent = '+'
  addCol.addEventListener('mousedown', (e) => {
    e.preventDefault()
    focusTableWrapper(wrapper, ctx)
    runCmd(ctx, addColAfterCommand)
  })

  const addRow = document.createElement('button')
  addRow.type = 'button'
  addRow.className = 'tela-table-add-row'
  addRow.setAttribute('aria-label', 'Add row')
  addRow.textContent = '+'
  addRow.addEventListener('mousedown', (e) => {
    e.preventDefault()
    focusTableWrapper(wrapper, ctx)
    runCmd(ctx, addRowAfterCommand)
  })

  wrapper.appendChild(addCol)
  wrapper.appendChild(addRow)
}

export const tableEnhancePlugin = $prose((ctx) => {
  return new Plugin({
    key: tableKey,
    props: {
      decorations(state) {
        return buildDecorations(state.doc)
      },
    },
    view(editorView) {
      const run = () => {
        if (editorView.editable) {
          editorView.dom
            .querySelectorAll('.tableWrapper')
            .forEach((w) => attachHoverButtons(w as HTMLElement, ctx))
          return
        }
        enhanceReadonlyTablesInRoot(editorView.dom)
      }
      run()
      return { update: run }
    },
  })
})
export { createTableKeymapPlugin } from './milkdown-table-keymap'
