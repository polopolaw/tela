import { useEffect, useRef } from 'react'
import { tooltipFactory } from '@milkdown/kit/plugin/tooltip'
import { usePluginViewContext } from '@prosemirror-adapter/react'
import { useInstance } from '@milkdown/react'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/ctx'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  addColAfterCommand,
  addRowAfterCommand,
} from '@milkdown/kit/preset/gfm'
import { isInTable } from '@milkdown/kit/prose/tables'
import {
  Columns,
  Hash,
  Heading,
  Rows,
  Type,
} from 'lucide-react'
import { positionFloating, setShow } from './milkdown-floating'
import {
  insertNumberedColumnCommand,
  toggleSubheaderRowCommand,
  toggleTableHeaderRowCommand,
} from './milkdown-table'

// eslint-disable-next-line react-refresh/only-export-components -- milkdown plugin slice lives with its view
export const tableToolbarPlugin = tooltipFactory('tela-table-toolbar')

interface TableAction {
  id: string
  label: string
  icon: typeof Rows
  run: (ctx: Ctx) => void
}

const ACTIONS: TableAction[] = [
  {
    id: 'row',
    label: 'Add row',
    icon: Rows,
    run: (ctx) => ctx.get(commandsCtx).call(addRowAfterCommand.key),
  },
  {
    id: 'col',
    label: 'Add column',
    icon: Columns,
    run: (ctx) => ctx.get(commandsCtx).call(addColAfterCommand.key),
  },
  {
    id: 'num',
    label: 'Numbered column',
    icon: Hash,
    run: (ctx) => ctx.get(commandsCtx).call(insertNumberedColumnCommand.key),
  },
  {
    id: 'header',
    label: 'Header row',
    icon: Heading,
    run: (ctx) => ctx.get(commandsCtx).call(toggleTableHeaderRowCommand.key),
  },
  {
    id: 'subheader',
    label: 'Subheader row',
    icon: Type,
    run: (ctx) => ctx.get(commandsCtx).call(toggleSubheaderRowCommand.key),
  },
]

function shouldShow(view: EditorView): boolean {
  return view.editable && view.hasFocus() && isInTable(view.state)
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
    const pos = view.state.selection.$from.pos
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

  const run = (action: TableAction) => {
    if (loading) return
    getEditor()?.action((ctx) => {
      action.run(ctx)
      ctx.get(editorViewCtx).focus()
    })
  }

  return (
    <div
      ref={ref}
      className="tela-table-toolbar"
      data-show="false"
      role="toolbar"
      aria-label="Table actions"
      onMouseDown={(e) => e.preventDefault()}
    >
      {ACTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className="tela-table-toolbar-btn"
          aria-label={label}
          title={label}
          onClick={() => run(ACTIONS.find((a) => a.id === id)!)}
        >
          <Icon width={14} height={14} />
        </button>
      ))}
    </div>
  )
}
