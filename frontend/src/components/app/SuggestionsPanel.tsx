import { Link } from '@tanstack/react-router'
import { GitPullRequest } from 'lucide-react'
import {
  usePageSuggestions,
  type PageSuggestion,
} from '../../lib/queries/page-suggestions'
import { relativeTimeFromSqlite } from '../../lib/relativeTime'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { cn } from '../../lib/utils'

interface SuggestionsPanelProps {
  spaceId: number
  pageId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  canReview: boolean
}

export function SuggestionsPanel({
  spaceId,
  pageId,
  open,
  onOpenChange,
  canReview,
}: SuggestionsPanelProps) {
  const openQuery = usePageSuggestions({
    pageId,
    status: 'open',
    enabled: open,
  })
  const suggestions = openQuery.data ?? []
  const count = suggestions.length

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        className="flex flex-col"
        withOverlay={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>Suggestions</SheetTitle>
          <SheetDescription>
            {count === 0
              ? 'No open suggestions on this page.'
              : count === 1
                ? '1 open suggestion awaiting review.'
                : `${count} open suggestions awaiting review.`}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-[var(--space-3)]">
          {openQuery.isLoading ? (
            <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
              Loading…
            </p>
          ) : openQuery.isError ? (
            <p
              role="alert"
              className="m-0 text-[length:var(--text-sm)] text-[var(--danger)]"
            >
              Couldn't load suggestions.
            </p>
          ) : suggestions.length === 0 ? (
            <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
              {canReview
                ? 'When a viewer suggests an edit, it will appear here for review.'
                : 'Submit a suggestion from the page to propose changes.'}
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col gap-[var(--space-2)]">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.id}
                  spaceId={spaceId}
                  pageId={pageId}
                  suggestion={s}
                  canReview={canReview}
                  onNavigate={() => onOpenChange(false)}
                />
              ))}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

interface SuggestionRowProps {
  spaceId: number
  pageId: number
  suggestion: PageSuggestion
  canReview: boolean
  onNavigate: () => void
}

function SuggestionRow({
  spaceId,
  pageId,
  suggestion,
  canReview,
  onNavigate,
}: SuggestionRowProps) {
  const author = suggestion.author_username ?? 'Someone'
  const rel = relativeTimeFromSqlite(suggestion.created_at)
  const preview =
    suggestion.summary?.trim() ||
    suggestion.body.trim().slice(0, 120) ||
    'Suggested edit'

  const inner = (
    <div className="flex flex-col gap-[var(--space-1)] min-w-0">
      <span className="flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-primary)]">
        <GitPullRequest width={14} height={14} aria-hidden className="shrink-0" />
        <span className="truncate">#{suggestion.id} · {author}</span>
      </span>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)] line-clamp-2">
        {preview}
      </span>
      <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{rel}</span>
    </div>
  )

  if (canReview) {
    return (
      <li className="m-0 p-0 list-none">
        <Link
          to="/spaces/$spaceId/pages/$pageId/suggestions/$suggestionId"
          params={{ spaceId, pageId, suggestionId: suggestion.id }}
          onClick={onNavigate}
          className={cn(
            'block w-full text-left no-underline',
            'px-[var(--space-3)] py-[var(--space-2)]',
            'rounded-[var(--radius-sm)] border border-transparent',
            'hover:bg-[var(--surface-2)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
          )}
        >
          {inner}
        </Link>
      </li>
    )
  }

  return (
    <li className="m-0 p-0 list-none">
      <div
        className={cn(
          'px-[var(--space-3)] py-[var(--space-2)]',
          'rounded-[var(--radius-sm)] bg-[var(--surface-2)]',
        )}
      >
        {inner}
        <Badge variant="muted" className="mt-[var(--space-2)]">
          Pending review
        </Badge>
      </div>
    </li>
  )
}

/** Compact badge for the page header when open suggestions exist. */
export function OpenSuggestionsBadge({
  count,
  onClick,
}: {
  count: number
  onClick: () => void
}) {
  if (count <= 0) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${count} open suggestion${count === 1 ? '' : 's'}`}
      onClick={onClick}
      className="h-[var(--space-8)] px-[var(--space-3)]"
    >
      <GitPullRequest width={16} height={16} />
      <span>
        {count} open suggestion{count === 1 ? '' : 's'}
      </span>
    </Button>
  )
}
