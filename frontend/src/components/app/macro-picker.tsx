import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMacro, useMacroList } from '../../lib/queries/macros'
import { useAllPages, usePage } from '../../lib/queries/pages'
import type { PageListItem } from '../../lib/types'
import { previewExcerpt } from './wikilink-hover-preview'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

export interface MacroPickerSelection {
  macroId?: string
  pageId?: number
}

export interface MacroPickerProps {
  spaceId: number
  anchor: { left: number; top: number; bottom: number }
  onSelect: (sel: MacroPickerSelection) => void
  onClose: () => void
}

type Tab = 'macros' | 'pages'

function filterMacros(
  items: { macro_id: string; title: string; page_id: number }[],
  q: string,
) {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  return items.filter(
    (m) =>
      m.macro_id.toLowerCase().includes(needle) ||
      m.title.toLowerCase().includes(needle),
  )
}

function filterPages(items: PageListItem[], spaceId: number, q: string) {
  const needle = q.trim().toLowerCase()
  return items
    .filter((p) => p.space_id === spaceId)
    .filter(
      (p) =>
        !needle ||
        p.title.toLowerCase().includes(needle) ||
        String(p.id).includes(needle),
    )
    .slice(0, 80)
}

export function MacroPicker({
  spaceId,
  anchor,
  onSelect,
  onClose,
}: MacroPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('macros')
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)

  const macrosQuery = useMacroList(spaceId > 0 ? spaceId : null)
  const allPages = useAllPages()

  const macroItems = useMemo(
    () => filterMacros(macrosQuery.data ?? [], query),
    [macrosQuery.data, query],
  )
  const pageItems = useMemo(
    () => filterPages(allPages.data ?? [], spaceId, query),
    [allPages.data, spaceId, query],
  )

  const listLen = tab === 'macros' ? macroItems.length : pageItems.length
  const activeMacroId =
    tab === 'macros' ? macroItems[activeIdx]?.macro_id : undefined
  const activePageId =
    tab === 'pages' ? pageItems[activeIdx]?.id : undefined

  const macroPreview = useMacro(activeMacroId)
  const pagePreview = usePage(activePageId)

  useEffect(() => {
    setActiveIdx(0)
  }, [tab, query])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.style.left = `${anchor.left}px`
    el.style.top = `${anchor.bottom + 4}px`
    const rafId = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const vw = window.innerWidth
      let top = anchor.bottom + 4
      if (top + r.height > vh && anchor.top > vh - anchor.bottom) {
        top = anchor.top - r.height - 4
      }
      top = Math.max(4, Math.min(top, vh - r.height - 4))
      let left = anchor.left
      if (left + r.width > vw) left = vw - r.width - 4
      left = Math.max(4, left)
      el.style.top = `${top}px`
      el.style.left = `${left}px`
    })
    return () => cancelAnimationFrame(rafId)
  }, [anchor])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => (listLen ? (i + 1) % listLen : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (listLen ? (i - 1 + listLen) % listLen : 0))
        return
      }
      if (e.key === 'Enter' && listLen > 0) {
        e.preventDefault()
        if (tab === 'macros') {
          onSelect({ macroId: macroItems[activeIdx].macro_id })
        } else {
          onSelect({ pageId: pageItems[activeIdx].id })
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [
    activeIdx,
    listLen,
    macroItems,
    pageItems,
    onClose,
    onSelect,
    tab,
  ])

  useEffect(() => {
    function onDown(e: PointerEvent) {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const previewTitle =
    tab === 'macros'
      ? macroItems[activeIdx]?.title
      : pageItems[activeIdx]?.title
  const previewExcerptText =
    tab === 'macros'
      ? macroPreview.data
        ? previewExcerpt(macroPreview.data.body, 400)
        : macroPreview.isLoading
          ? 'Loading preview…'
          : 'Select a macro to preview'
      : pagePreview.data
        ? previewExcerpt(pagePreview.data.body, 400)
        : pagePreview.isLoading
          ? 'Loading preview…'
          : activePageId
            ? `Whole-page include · id ${activePageId}`
            : 'Select a page to include'

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Insert macro include"
      className="tela-macro-picker"
    >
      <div className="tela-macro-picker-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'macros'}
          className={cn('tela-macro-picker-tab', tab === 'macros' && 'is-active')}
          onMouseDown={(e) => {
            e.preventDefault()
            setTab('macros')
          }}
        >
          Macros
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pages'}
          className={cn('tela-macro-picker-tab', tab === 'pages' && 'is-active')}
          onMouseDown={(e) => {
            e.preventDefault()
            setTab('pages')
          }}
        >
          Page include
        </button>
      </div>
      <Input
        size="sm"
        className="tela-macro-picker-search"
        placeholder={tab === 'macros' ? 'Search macros…' : 'Search pages…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="tela-macro-picker-body">
        <div className="tela-macro-picker-list" role="listbox">
          {spaceId <= 0 ? (
            <p className="tela-macro-picker-empty">Space not available</p>
          ) : tab === 'macros' ? (
            macrosQuery.isLoading ? (
              <p className="tela-macro-picker-empty">Loading macros…</p>
            ) : macroItems.length === 0 ? (
              <p className="tela-macro-picker-empty">
                No macros in this space yet. Wrap content in a macro definition first.
              </p>
            ) : (
              macroItems.map((m, i) => (
                <button
                  key={m.macro_id}
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx}
                  className={cn(
                    'tela-macro-picker-item',
                    i === activeIdx && 'is-active',
                  )}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onSelect({ macroId: m.macro_id })
                  }}
                >
                  <span className="tela-macro-picker-item-title">{m.title}</span>
                  <span className="tela-macro-picker-item-meta">{m.macro_id}</span>
                </button>
              ))
            )
          ) : pageItems.length === 0 ? (
            <p className="tela-macro-picker-empty">No matching pages</p>
          ) : (
            pageItems.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={i === activeIdx}
                className={cn(
                  'tela-macro-picker-item',
                  i === activeIdx && 'is-active',
                )}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onSelect({ pageId: p.id })
                }}
              >
                <span className="tela-macro-picker-item-title">{p.title}</span>
                <span className="tela-macro-picker-item-meta">page {p.id}</span>
              </button>
            ))
          )}
        </div>
        <div className="tela-macro-picker-preview" aria-live="polite">
          <div className="tela-macro-picker-preview-title">{previewTitle}</div>
          <div className="tela-macro-picker-preview-body">{previewExcerptText}</div>
        </div>
      </div>
    </div>
  )
}
