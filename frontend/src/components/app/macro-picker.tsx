import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchPages } from '../../lib/api'
import { useMacroList } from '../../lib/queries/macros'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { previewExcerpt } from './wikilink-hover-preview'
import { Input } from '../ui/input'
import { cn } from '../../lib/utils'

export interface MacroPickerSelection {
  macroId?: string
  pageId?: number
}

export interface MacroPickerProps {
  spaceId: number
  /** Current page — excluded from whole-page include hits. */
  excludePageId?: number
  anchor: { left: number; top: number; bottom: number }
  onSelect: (sel: MacroPickerSelection) => void
  onClose: () => void
}

type PickerRow =
  | {
      kind: 'block'
      macroId: string
      pageId: number
      title: string
      excerpt: string
    }
  | {
      kind: 'page'
      pageId: number
      title: string
      excerpt: string
    }

function snippetToPlain(snippet: string): string {
  return snippet.replace(/<\/?mark>/gi, '').trim()
}

export function MacroPicker({
  spaceId,
  excludePageId = 0,
  anchor,
  onSelect,
  onClose,
}: MacroPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const debouncedQuery = useDebouncedValue(query.trim(), 150)

  const macrosQuery = useMacroList(spaceId > 0 ? spaceId : null, debouncedQuery)
  const pagesQuery = useQuery({
    queryKey: ['macro-picker-pages', spaceId, debouncedQuery],
    enabled: spaceId > 0 && debouncedQuery.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      searchPages(debouncedQuery, { spaceId, signal }).then((r) => r.results),
  })

  const rows = useMemo(() => {
    const out: PickerRow[] = []
    for (const m of macrosQuery.data ?? []) {
      out.push({
        kind: 'block',
        macroId: m.macro_id,
        pageId: m.page_id,
        title: m.title,
        excerpt: previewExcerpt(m.body, 140),
      })
    }
    if (debouncedQuery.length > 0) {
      for (const p of pagesQuery.data ?? []) {
        if (excludePageId > 0 && p.page_id === excludePageId) continue
        out.push({
          kind: 'page',
          pageId: p.page_id,
          title: p.title,
          excerpt: snippetToPlain(p.snippet) || 'Whole-page include',
        })
      }
    }
    return out
  }, [macrosQuery.data, pagesQuery.data, debouncedQuery, excludePageId])

  const activeRow = rows[activeIdx]

  useEffect(() => {
    setActiveIdx(0)
  }, [debouncedQuery, rows.length])

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
  }, [anchor, rows.length])

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
        setActiveIdx((i) => (rows.length ? (i + 1) % rows.length : 0))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
        return
      }
      if (e.key === 'Enter' && rows.length > 0) {
        e.preventDefault()
        const row = rows[activeIdx]
        if (row.kind === 'block') {
          onSelect({ macroId: row.macroId })
        } else {
          onSelect({ pageId: row.pageId })
        }
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [activeIdx, rows, onClose, onSelect])

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

  const previewTitle = activeRow
    ? activeRow.kind === 'page'
      ? `${activeRow.title} (whole page)`
      : activeRow.title
    : 'Insert macro'
  const previewBody = activeRow
    ? activeRow.kind === 'page'
      ? activeRow.excerpt
      : macrosQuery.data?.find((m) => m.macro_id === activeRow.macroId)?.body
        ? previewExcerpt(
            macrosQuery.data.find((m) => m.macro_id === activeRow.macroId)!.body,
            500,
          )
        : activeRow.excerpt
    : debouncedQuery
      ? 'Type to search reusable blocks and pages in this space'
      : 'All reusable blocks in this space are listed here — pick one to insert a live include'

  const loading = macrosQuery.isLoading || (debouncedQuery.length > 0 && pagesQuery.isFetching)

  let blockIdx = 0
  let pageIdx = 0

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Insert macro include"
      className="tela-macro-picker"
    >
      <Input
        size="sm"
        className="tela-macro-picker-search"
        placeholder="Search blocks and pages in this space…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="tela-macro-picker-body">
        <div className="tela-macro-picker-list" role="listbox">
          {spaceId <= 0 ? (
            <p className="tela-macro-picker-empty">Space not available</p>
          ) : loading && rows.length === 0 ? (
            <p className="tela-macro-picker-empty">Searching…</p>
          ) : rows.length === 0 ? (
            <p className="tela-macro-picker-empty">
              {debouncedQuery
                ? 'No matching blocks or pages in this space'
                : 'No reusable blocks in this space yet. Wrap content in a macro definition first.'}
            </p>
          ) : (
            rows.map((row, i) => {
              const showBlockHeader = row.kind === 'block' && blockIdx++ === 0
              const showPageHeader =
                row.kind === 'page' && pageIdx++ === 0 && debouncedQuery.length > 0
              return (
                <div key={row.kind === 'block' ? `b-${row.macroId}` : `p-${row.pageId}`}>
                  {showBlockHeader ? (
                    <div className="tela-macro-picker-section">Reusable blocks</div>
                  ) : null}
                  {showPageHeader ? (
                    <div className="tela-macro-picker-section">Whole pages</div>
                  ) : null}
                  <button
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
                      if (row.kind === 'block') {
                        onSelect({ macroId: row.macroId })
                      } else {
                        onSelect({ pageId: row.pageId })
                      }
                    }}
                  >
                    <span className="tela-macro-picker-item-title">{row.title}</span>
                    <span className="tela-macro-picker-item-excerpt">{row.excerpt}</span>
                    {row.kind === 'page' ? (
                      <span className="tela-macro-picker-item-meta">whole page</span>
                    ) : null}
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div className="tela-macro-picker-preview" aria-live="polite">
          <div className="tela-macro-picker-preview-title">{previewTitle}</div>
          <div className="tela-macro-picker-preview-body">{previewBody}</div>
        </div>
      </div>
    </div>
  )
}
