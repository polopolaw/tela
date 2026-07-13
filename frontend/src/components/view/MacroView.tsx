import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MarkdownView } from './MarkdownView'
import {
  fetchMacro,
  fetchPageInclude,
  macroKeys,
  MACRO_MAX_DEPTH,
  type MacroSurface,
} from '../../lib/queries/macros'
import { subscribeToPageMutation } from '../../lib/pageMutationEvent'
import { cn } from '../../lib/utils'

export interface MdNodeLite {
  type: string
  children?: MdNodeLite[]
  attributes?: Record<string, string | null | undefined>
  [k: string]: unknown
}

export interface MacroRenderContextValue {
  macroDepth?: number
  visitedMacroIds?: Set<string>
  visitedPageIds?: Set<number>
  shareToken?: string
  publicSpaceId?: number
  pageId?: number
  resolveWikilink?: (slug: string) => number | null
  pageHref?: (pageId: number) => string
  wikilinkUnresolved?: 'broken' | 'plain'
  canVote?: boolean
}

export const MacroRenderContext = createContext<MacroRenderContextValue>({})

function directiveAttrs(node: MdNodeLite): Record<string, string> {
  const a = node.attributes
  if (!a || typeof a !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function macroSurface(ctx: MacroRenderContextValue): MacroSurface {
  return {
    shareToken: ctx.shareToken,
    publicSpaceId: ctx.publicSpaceId,
  }
}

function MacroPlaceholder({
  children,
  className,
  pending,
}: {
  children: ReactNode
  className?: string
  pending?: boolean
}) {
  return (
    <div
      className={cn('tela-macro tela-macro-placeholder', className)}
      {...(pending ? { 'data-macro-pending': '' } : {})}
    >
      {children}
    </div>
  )
}

export function MacroDefView({
  node,
  renderChild,
}: {
  node: MdNodeLite
  renderChild: (node: MdNodeLite, key: number) => ReactNode
}) {
  const attrs = directiveAttrs(node)
  const macroId = attrs.id ?? ''
  return (
    <div className="tela-macro-def" data-macro-def="" data-macro-id={macroId}>
      {node.children?.map((child, i) => renderChild(child, i))}
    </div>
  )
}

export function MacroView({ node }: { node: MdNodeLite }) {
  const ctx = useContext(MacroRenderContext)
  const qc = useQueryClient()
  const attrs = directiveAttrs(node)
  const macroId = attrs.id ?? ''
  const pageIdStr = attrs.page ?? ''
  const targetPageId = pageIdStr ? Number.parseInt(pageIdStr, 10) : 0
  const isPageInclude = !macroId && targetPageId > 0
  const depth = ctx.macroDepth ?? 0
  const visitedMacros = ctx.visitedMacroIds ?? new Set<string>()
  const visitedPages = ctx.visitedPageIds ?? new Set<number>()
  const surface = macroSurface(ctx)

  useEffect(() => {
    return subscribeToPageMutation(() => {
      if (macroId) qc.invalidateQueries({ queryKey: macroKeys.detail(macroId, surface) })
      if (targetPageId > 0) {
        qc.invalidateQueries({ queryKey: macroKeys.pageInclude(targetPageId, surface) })
      }
    })
  }, [qc, macroId, targetPageId, surface])

  if (depth >= MACRO_MAX_DEPTH) {
    return (
      <MacroPlaceholder className="tela-macro-error">
        Circular or deeply nested macro reference
      </MacroPlaceholder>
    )
  }

  if (macroId && visitedMacros.has(macroId)) {
    return (
      <MacroPlaceholder className="tela-macro-error">
        Circular macro reference
      </MacroPlaceholder>
    )
  }

  if (isPageInclude && visitedPages.has(targetPageId)) {
    return (
      <MacroPlaceholder className="tela-macro-error">
        Circular page include
      </MacroPlaceholder>
    )
  }

  if (!macroId && !isPageInclude) {
    return (
      <MacroPlaceholder className="tela-macro-error">
        Empty macro reference
      </MacroPlaceholder>
    )
  }

  const macroQuery = useQuery({
    queryKey: macroKeys.detail(macroId, surface),
    enabled: !!macroId,
    staleTime: 30_000,
    queryFn: () => fetchMacro(macroId, surface),
  })

  const pageQuery = useQuery({
    queryKey: macroKeys.pageInclude(targetPageId, surface),
    enabled: isPageInclude,
    staleTime: 30_000,
    queryFn: () => fetchPageInclude(targetPageId, surface),
  })

  const q = isPageInclude ? pageQuery : macroQuery
  const payload = isPageInclude ? pageQuery.data : macroQuery.data

  if (q.isLoading) {
    return (
      <MacroPlaceholder pending>
        <span className="tela-macro-loading">Loading included content…</span>
      </MacroPlaceholder>
    )
  }

  if (q.isError) {
    const status = (q.error as Error & { status?: number })?.status
    const msg =
      status === 403
        ? 'Included content is not accessible'
        : status === 404
          ? 'Included content not found'
          : 'Failed to load included content'
    return <MacroPlaceholder className="tela-macro-error">{msg}</MacroPlaceholder>
  }

  if (!payload) {
    return <MacroPlaceholder className="tela-macro-error">No content</MacroPlaceholder>
  }

  const body = payload.body
  const title = payload.title
  const sourcePageId = payload.page_id
  const nextMacros = new Set(visitedMacros)
  const nextPages = new Set(visitedPages)
  if (macroId) nextMacros.add(macroId)
  if (isPageInclude) nextPages.add(targetPageId)

  const sourceHref = ctx.pageHref?.(sourcePageId)

  return (
    <div className="tela-macro tela-macro-live" data-macro-resolved="">
      <div className="tela-macro-badge">
        {sourceHref ? (
          <a href={sourceHref} className="tela-macro-source">
            ↗ {title}
          </a>
        ) : (
          <span className="tela-macro-source">↗ {title}</span>
        )}
        <span className="tela-macro-live-label">live</span>
      </div>
      <div className="tela-macro-body">
        <MarkdownView
          body={body}
          pageId={sourcePageId}
          macroDepth={depth + 1}
          visitedMacroIds={nextMacros}
          visitedPageIds={nextPages}
          shareToken={ctx.shareToken}
          publicSpaceId={ctx.publicSpaceId}
          resolveWikilink={ctx.resolveWikilink}
          pageHref={ctx.pageHref}
          wikilinkUnresolved={ctx.wikilinkUnresolved}
          canVote={ctx.canVote}
        />
      </div>
    </div>
  )
}
