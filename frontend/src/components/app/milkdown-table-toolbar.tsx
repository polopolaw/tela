import { useEffect, useRef } from 'react'
import { tooltipFactory } from '@milkdown/kit/plugin/tooltip'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { useInstance } from '@milkdown/react'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { CmdKey } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/ctx'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { findTable } from '@milkdown/kit/prose/tables'
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  selectColCommand,
  selectRowCommand,
  selectTableCommand,
} from '@milkdown/kit/preset/gfm'
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns2,
  Rows2,
  Trash2,
} from 'lucide-react'
import { positionFloating, setShow } from './milkdown-floating'
import { cn } from '../../lib/utils'

// eslint-disable-next-line react-refresh/only-export-components -- milkdown plugin slice lives with its view
export const tableToolbarPlugin = tooltipFactory('tela-table-toolbar')

function isInTable(state: EditorState): boolean {
  return findTable(state.selection.$from) != null
}

function shouldShow(view: EditorView): boolean {
  if (!view.editable || !view.hasFocus()) return false
  return isInTable(view.state)
}

export function TableToolbarView() {
  const ref = useRef<HTMLDivElement>(null)
  const { view } = usePluginViewContext()
  const [loading, getEditor] = useInstance()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = view.dom.parentElement
    if (parent && el.parentElement !== parent) parent.appendChild(el)
  }, [view])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!shouldShow(view)) {
      setShow(el, false)
      return
    }
    setShow(el, true)
    const pos = view.state.selection.from
    let coords
    try {
      coords = view.coordsAtPos(pos)
    } catch {
      return
    }
    return positionFloating(
      el,
      { top: coords.top, bottom: coords.bottom, left: coords.left },
      { place: 'above', gap: 8, align: 'start' },
    )
  })

  function runAction(fn: (ctx: Ctx) => void) {
    if (loading) return
    getEditor()?.action((ctx) => fn(ctx))
  }

  function runCommand(key: CmdKey<unknown>, payload?: unknown) {
    runAction((ctx) => {
      const commands = ctx.get(commandsCtx)
      if (payload === undefined) commands.call(key)
      else commands.call(key, payload)
      ctx.get(editorViewCtx).focus()
    })
  }

  function deleteRow() {
    runAction((ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(selectRowCommand.key)
      commands.call(deleteSelectedCellsCommand.key)
      ctx.get(editorViewCtx).focus()
    })
  }

  function deleteCol() {
    runAction((ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(selectColCommand.key)
      commands.call(deleteSelectedCellsCommand.key)
      ctx.get(editorViewCtx).focus()
    })
  }

  function deleteTable() {
    runAction((ctx) => {
      const commands = ctx.get(commandsCtx)
      commands.call(selectTableCommand.key)
      commands.call(deleteSelectedCellsCommand.key)
      ctx.get(editorViewCtx).focus()
    })
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Table"
      title="Tab in the last cell adds a new row"
      className={cn('tela-bubble-toolbar', 'tela-table-toolbar')}
    >
      <TableButton label="Add row above" onClick={() => runCommand(addRowBeforeCommand.key)}>
        <ArrowUpToLine size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <TableButton label="Add row below" onClick={() => runCommand(addRowAfterCommand.key)}>
        <ArrowDownToLine size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <TableButton label="Delete row" onClick={deleteRow}>
        <Rows2 size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <span className="tela-table-toolbar-sep" aria-hidden />
      <TableButton label="Add column left" onClick={() => runCommand(addColBeforeCommand.key)}>
        <ArrowLeftToLine size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <TableButton label="Add column right" onClick={() => runCommand(addColAfterCommand.key)}>
        <ArrowRightToLine size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <TableButton label="Delete column" onClick={deleteCol}>
        <Columns2 size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
      <span className="tela-table-toolbar-sep" aria-hidden />
      <TableButton label="Delete table" onClick={deleteTable}>
        <Trash2 size="1em" strokeWidth={2.25} aria-hidden />
      </TableButton>
    </div>
  )
}

interface TableButtonProps {
  label: string
  onClick: () => void
  children: React.ReactNode
}

function TableButton({ label, onClick, children }: TableButtonProps) {
  return (
    <button
      type="button"
      className="tela-bubble-btn"
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
    >
      {children}
    </button>
  )
}
