import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { FileText, Layers } from 'lucide-react'
import { useBacklinks } from '../../lib/queries/pages'
import { HighlightedSnippet } from '../../lib/highlightSnippet'
import { disambiguateBreadcrumbs } from '../../lib/disambiguateBreadcrumbs'
import { CollapsibleSection } from '../ui/collapsible-section'
import { usePageHoverPreview } from './wikilink-hover-preview'
import { cn } from '../../lib/utils'
import type { Backlink, MacroInclude } from '../../lib/types'

interface BacklinksSectionProps {
  pageId: number
}

function ConnectionRow({
  row,
  preview,
  subtitle,
}: {
  row: { item: Backlink | MacroInclude; breadcrumbLabel: string; showSpaceChip: boolean }
  preview: ReturnType<typeof usePageHoverPreview>
  subtitle?: string
}) {
  return (
    <li className="m-0 p-0 list-none">
      <Link
        {...preview.triggerProps(row.item.page_id, row.item.title)}
        to="/spaces/$spaceId/pages/$pageId/{-$slug}"
        params={{
          spaceId: row.item.space_id,
          pageId: row.item.page_id,
          slug: undefined,
        }}
        className={cn(
          'group block w-full no-underline',
          'flex items-start gap-[var(--space-3)]',
          'px-[var(--space-3)] py-[var(--space-2)]',
          'rounded-[var(--radius-sm)]',
          'hover:bg-[var(--surface-2)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
        )}
      >
        <FileText
          aria-hidden
          width={14}
          height={14}
          className="mt-[2px] shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
        />
        <span className="flex-1 min-w-0 flex flex-col gap-[2px]">
          <span className="flex items-center gap-[var(--space-2)] min-w-0">
            <span className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)] font-medium font-[family-name:var(--font-sans)]">
              {row.item.title || 'Untitled'}
            </span>
            {row.showSpaceChip ? (
              <span
                className={cn(
                  'shrink-0',
                  'font-[family-name:var(--font-sans)]',
                  'text-[length:var(--text-xs)] leading-[var(--leading-tight)]',
                  'text-[var(--text-muted)]',
                  'bg-[var(--surface-1)] border border-[var(--border-subtle)]',
                  'rounded-[var(--radius-sm)]',
                  'px-[var(--space-2)] py-[1px]',
                )}
              >
                {row.item.space_name}
              </span>
            ) : null}
          </span>
          <span className="truncate text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
            {row.breadcrumbLabel}
          </span>
          {subtitle ? (
            <span className="truncate text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
              {subtitle}
            </span>
          ) : 'snippet' in row.item && row.item.snippet ? (
            <span className="truncate text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
              <HighlightedSnippet snippet={row.item.snippet} />
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

export function BacklinksSection({ pageId }: BacklinksSectionProps) {
  const { data, isLoading, isError } = useBacklinks(pageId)
  const preview = usePageHoverPreview()
  const backlinkRows = useMemo(
    () => disambiguateBreadcrumbs(data?.backlinks ?? []),
    [data?.backlinks],
  )
  const macroRows = useMemo(
    () => disambiguateBreadcrumbs(data?.macroIncludes ?? []),
    [data?.macroIncludes],
  )

  if (isLoading || isError) return null
  if (backlinkRows.length === 0 && macroRows.length === 0) return null

  return (
    <>
      {backlinkRows.length > 0 ? (
        <CollapsibleSection
          title={
            backlinkRows.length === 1
              ? '1 page links here'
              : `${backlinkRows.length} pages link here`
          }
          persistKey="tela:page-backlinks-open"
        >
          <ul className="m-0 p-0 list-none flex flex-col gap-[1px]">
            {backlinkRows.map((row) => (
              <ConnectionRow key={row.item.page_id} row={row} preview={preview} />
            ))}
          </ul>
        </CollapsibleSection>
      ) : null}
      {macroRows.length > 0 ? (
        <CollapsibleSection
          title={
            macroRows.length === 1
              ? '1 page includes here'
              : `${macroRows.length} pages include here`
          }
          persistKey="tela:page-macro-includes-open"
        >
          <ul className="m-0 p-0 list-none flex flex-col gap-[1px]">
            {macroRows.map((row) => {
              const inc = row.item as MacroInclude
              const subtitle =
                inc.kind === 'page'
                  ? 'Includes whole page (live)'
                  : inc.macro_id
                    ? `Includes macro ${inc.macro_id}`
                    : 'Includes macro (live)'
              return (
                <li key={`macro-${row.item.page_id}-${inc.macro_id ?? 'page'}`} className="m-0 p-0 list-none">
                  <Link
                    {...preview.triggerProps(row.item.page_id, row.item.title)}
                    to="/spaces/$spaceId/pages/$pageId/{-$slug}"
                    params={{
                      spaceId: row.item.space_id,
                      pageId: row.item.page_id,
                      slug: undefined,
                    }}
                    className={cn(
                      'group block w-full no-underline',
                      'flex items-start gap-[var(--space-3)]',
                      'px-[var(--space-3)] py-[var(--space-2)]',
                      'rounded-[var(--radius-sm)]',
                      'hover:bg-[var(--surface-2)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
                    )}
                  >
                    <Layers
                      aria-hidden
                      width={14}
                      height={14}
                      className="mt-[2px] shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)]"
                    />
                    <span className="flex-1 min-w-0 flex flex-col gap-[2px]">
                      <span className="flex items-center gap-[var(--space-2)] min-w-0">
                        <span className="truncate text-[length:var(--text-sm)] text-[var(--text-primary)] font-medium font-[family-name:var(--font-sans)]">
                          {row.item.title || 'Untitled'}
                        </span>
                        {row.showSpaceChip ? (
                          <span className="shrink-0 font-[family-name:var(--font-sans)] text-[length:var(--text-xs)] text-[var(--text-muted)] bg-[var(--surface-1)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[1px]">
                            {row.item.space_name}
                          </span>
                        ) : null}
                      </span>
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
                        {row.breadcrumbLabel}
                      </span>
                      <span className="truncate text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
                        {subtitle}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </CollapsibleSection>
      ) : null}
      {preview.card}
    </>
  )
}
