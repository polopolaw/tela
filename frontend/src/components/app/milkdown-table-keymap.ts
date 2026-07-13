import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  findTable,
  isInTable,
  nextCell,
  selectionCell,
  TableMap,
} from '@milkdown/kit/prose/tables'

const key = new PluginKey('tela-table-keymap')

function shouldAddRowOnEnter(state: import('@milkdown/kit/prose/state').EditorState): boolean {
  const $cell = selectionCell(state)
  const cell = $cell.nodeAfter ?? $cell.nodeBefore
  if (!cell) return false
  if (cell.childCount !== 1) return false
  const block = cell.child(0)
  if (block.type.name !== 'paragraph') return false
  const { $from, empty } = state.selection
  if (!empty) return false
  return $from.parentOffset === block.content.size
}

function isLastCellInRow(state: import('@milkdown/kit/prose/state').EditorState): boolean {
  const $cell = selectionCell(state)
  const table = findTable($cell)
  if (!table) return false
  const map = TableMap.get(table.node)
  const rect = map.findCell($cell.pos - table.start - 1)
  return rect.right === map.width
}

function isFirstCellInRow(state: import('@milkdown/kit/prose/state').EditorState): boolean {
  const $cell = selectionCell(state)
  const table = findTable($cell)
  if (!table) return false
  const map = TableMap.get(table.node)
  const rect = map.findCell($cell.pos - table.start - 1)
  return rect.left === 0
}

function focusCell(view: EditorView, axis: 'horiz' | 'vert', dir: number) {
  const $cell = selectionCell(view.state)
  const $next = nextCell($cell, axis, dir)
  if (!$next) return
  const inner = $next.pos + 1
  const sel = TextSelection.near(view.state.doc.resolve(inner), 1)
  view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
  view.focus()
}

export function createTableKeymapPlugin(): Plugin {
  return new Plugin({
    key,
    props: {
      handleKeyDown(view, event) {
        if (!view.editable || !isInTable(view.state)) return false

        if (event.key === 'Enter' && !event.shiftKey && shouldAddRowOnEnter(view.state)) {
          if (addRowAfter(view.state, view.dispatch)) {
            focusCell(view, 'vert', 1)
            const $cell = selectionCell(view.state)
            const table = findTable($cell)
            if (table) {
              const map = TableMap.get(table.node)
              const rect = map.findCell($cell.pos - table.start - 1)
              const firstCol = map.positionAt(rect.top, 0, table.node)
              const pos = table.start + 1 + firstCol + 1
              const sel = TextSelection.near(view.state.doc.resolve(pos), 1)
              view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
            }
            return true
          }
        }

        if (event.key === 'Tab' && !event.shiftKey && isLastCellInRow(view.state)) {
          if (addColumnAfter(view.state, view.dispatch)) {
            focusCell(view, 'horiz', 1)
            return true
          }
        }

        if (event.key === 'Tab' && event.shiftKey && isFirstCellInRow(view.state)) {
          if (addColumnBefore(view.state, view.dispatch)) {
            focusCell(view, 'horiz', -1)
            return true
          }
        }

        return false
      },
    },
  })
}
