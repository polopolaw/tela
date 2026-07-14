import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ChevronRight, GitPullRequest } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { usePage } from '../../lib/queries/pages'
import {
  useApplySuggestion,
  useRejectSuggestion,
  useSuggestion,
  useSuggestionHunks,
  useWithdrawSuggestion,
  type PageSuggestion,
  type SuggestionHunk,
  type SuggestionHunkSide,
} from '../../lib/queries/page-suggestions'
import { useSpace, useSpaceRole } from '../../lib/queries/spaces'
import { useMe } from '../../lib/queries/auth'
import { parseSqliteTs } from '../../lib/types'
import { relativeTimeFromSqlite } from '../../lib/relativeTime'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { TextArea } from '../ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle'
import { DiffViewer } from './DiffViewer'

interface SuggestionReviewViewProps {
  spaceId: number
  pageId: number
  suggestionId: number
}

export function SuggestionReviewRoute() {
  const { spaceId, pageId, suggestionId } = useParams({
    from: '/_app/spaces/$spaceId/pages/$pageId/suggestions/$suggestionId',
  })
  return (
    <SuggestionReviewView
      spaceId={spaceId}
      pageId={pageId}
      suggestionId={suggestionId}
    />
  )
}

export function SuggestionReviewView({
  spaceId,
  pageId,
  suggestionId,
}: SuggestionReviewViewProps) {
  const page = usePage(pageId)
  const suggestion = useSuggestion({ suggestionId })
  const me = useMe()
  const { resolved: roleResolved, isViewer } = useSpaceRole(spaceId)
  const canReview = roleResolved && !isViewer

  if (page.isError) {
    const status = page.error instanceof ApiError ? page.error.status : null
    if (status === 404) return <ReviewNotFound spaceId={spaceId} />
    return <ReviewError message="Couldn't load this page." onRetry={() => void page.refetch()} />
  }
  if (page.isLoading || !page.data) return <ReviewLoading />
  if (page.data.space_id !== spaceId) return <ReviewNotFound spaceId={spaceId} />

  if (suggestion.isError) {
    const status = suggestion.error instanceof ApiError ? suggestion.error.status : null
    if (status === 404) return <ReviewNotFound spaceId={spaceId} />
    return (
      <ReviewError
        message="Couldn't load this suggestion."
        onRetry={() => void suggestion.refetch()}
      />
    )
  }
  if (suggestion.isLoading || !suggestion.data) return <ReviewLoading />
  if (suggestion.data.page_id !== pageId) return <ReviewNotFound spaceId={spaceId} />

  if (!roleResolved) return <ReviewLoading />
  if (isViewer && me.data?.id !== suggestion.data.author_id) {
    return <ReviewViewerDenied spaceId={spaceId} pageId={pageId} />
  }

  return (
    <SuggestionReviewBody
      spaceId={spaceId}
      pageId={pageId}
      pageTitle={page.data.title}
      suggestion={suggestion.data}
      canReview={canReview}
    />
  )
}

interface SuggestionReviewBodyProps {
  spaceId: number
  pageId: number
  pageTitle: string
  suggestion: PageSuggestion
  canReview: boolean
}

function SuggestionReviewBody({
  spaceId,
  pageId,
  pageTitle,
  suggestion,
  canReview,
}: SuggestionReviewBodyProps) {
  const navigate = useNavigate()
  const me = useMe()
  const hunksQuery = useSuggestionHunks({
    suggestionId: suggestion.id,
    enabled: canReview && suggestion.status === 'open',
  })
  const applySuggestion = useApplySuggestion()
  const rejectSuggestion = useRejectSuggestion()
  const withdrawSuggestion = useWithdrawSuggestion()

  const [choices, setChoices] = useState<Record<string, SuggestionHunkSide>>({})
  const [rejectOpen, setRejectOpen] = useState(false)
  const [reviewNote, setReviewNote] = useState('')

  const hunks = hunksQuery.data?.hunks ?? []
  const summary = hunksQuery.data?.summary

  const resolvedChoices = useMemo(() => {
    const out: Record<string, SuggestionHunkSide> = {}
    for (const h of hunks) {
      if (h.kind === 'conflict') {
        if (choices[h.id]) out[h.id] = choices[h.id]
      } else {
        out[h.id] = choices[h.id] ?? h.default
      }
    }
    return out
  }, [hunks, choices])

  const unresolvedConflicts = useMemo(
    () => hunks.filter((h) => h.kind === 'conflict' && !choices[h.id]),
    [hunks, choices],
  )

  const partialChoices = useMemo(() => {
    const out: Record<string, SuggestionHunkSide> = {}
    for (const h of hunks) {
      const side = resolvedChoices[h.id]
      if (side === 'suggestion') out[h.id] = side
    }
    return out
  }, [hunks, resolvedChoices])

  const setHunkChoice = useCallback((hunkId: string, side: SuggestionHunkSide) => {
    setChoices((prev) => ({ ...prev, [hunkId]: side }))
  }, [])

  const isAuthor = me.data?.id === suggestion.author_id
  const isOpen = suggestion.status === 'open'
  const busy =
    applySuggestion.isPending || rejectSuggestion.isPending || withdrawSuggestion.isPending

  const goToPage = useCallback(() => {
    void navigate({
      to: '/spaces/$spaceId/pages/$pageId/{-$slug}',
      params: { spaceId, pageId, slug: undefined },
    })
  }, [navigate, spaceId, pageId])

  const handleApplyAll = () => {
    if (unresolvedConflicts.length > 0) return
    void applySuggestion
      .mutateAsync({
        suggestionId: suggestion.id,
        mode: 'full',
        choices: resolvedChoices,
        review_note: reviewNote.trim() || undefined,
      })
      .then(goToPage)
      .catch(() => {})
  }

  const handleApplySelected = () => {
    if (unresolvedConflicts.length > 0) return
    if (Object.keys(partialChoices).length === 0) return
    void applySuggestion
      .mutateAsync({
        suggestionId: suggestion.id,
        mode: 'partial',
        choices: partialChoices,
        review_note: reviewNote.trim() || undefined,
      })
      .then(goToPage)
      .catch(() => {})
  }

  const handleReject = () => {
    void rejectSuggestion
      .mutateAsync({
        suggestionId: suggestion.id,
        review_note: reviewNote.trim() || undefined,
      })
      .then(() => {
        setRejectOpen(false)
        goToPage()
      })
      .catch(() => {})
  }

  const handleWithdraw = () => {
    void withdrawSuggestion.mutateAsync(suggestion.id).then(goToPage).catch(() => {})
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center justify-between gap-[var(--space-4)] px-[var(--space-6)] py-[var(--space-3)] border-b border-[var(--border-subtle)] shrink-0">
        <ReviewBreadcrumb
          spaceId={spaceId}
          pageId={pageId}
          pageTitle={pageTitle}
          suggestionId={suggestion.id}
        />
        <div className="flex items-center gap-[var(--space-2)] flex-wrap justify-end">
          {isOpen && isAuthor ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleWithdraw}
              disabled={busy}
            >
              Withdraw
            </Button>
          ) : null}
          {isOpen && canReview ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setRejectOpen(true)}
                disabled={busy}
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleApplySelected}
                disabled={
                  busy ||
                  unresolvedConflicts.length > 0 ||
                  Object.keys(partialChoices).length === 0
                }
                title={
                  unresolvedConflicts.length > 0
                    ? 'Resolve all conflicts before applying'
                    : undefined
                }
              >
                Apply selected
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleApplyAll}
                disabled={busy || unresolvedConflicts.length > 0}
                title={
                  unresolvedConflicts.length > 0
                    ? 'Resolve all conflicts before applying'
                    : undefined
                }
              >
                Apply all
              </Button>
            </>
          ) : null}
          <Button asChild variant="ghost" size="sm">
            <Link
              to="/spaces/$spaceId/pages/$pageId/{-$slug}"
              params={{ spaceId, pageId, slug: undefined }}
            >
              Back to page
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0 p-[var(--space-7)] max-w-[72rem] w-full self-center">
        <div className="flex flex-col gap-[var(--space-6)]">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-[var(--space-2)] flex-wrap">
                <GitPullRequest width={18} height={18} aria-hidden />
                <CardTitle>Suggestion #{suggestion.id}</CardTitle>
                <StatusBadge status={suggestion.status} />
              </div>
              <CardDescription>
                {suggestion.author_username ?? 'Someone'} ·{' '}
                {relativeTimeFromSqlite(suggestion.created_at)}
                {suggestion.reviewed_at ? (
                  <>
                    {' '}
                    · reviewed {parseSqliteTs(suggestion.reviewed_at).toLocaleString()}
                    {suggestion.reviewed_by_username
                      ? ` by ${suggestion.reviewed_by_username}`
                      : ''}
                  </>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardBody className="flex flex-col gap-[var(--space-3)]">
              {suggestion.summary ? (
                <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-primary)]">
                  {suggestion.summary}
                </p>
              ) : null}
              {suggestion.review_note ? (
                <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  Review note: {suggestion.review_note}
                </p>
              ) : null}
              {summary ? (
                <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {summary.suggestion_only} suggestion-only · {summary.live_only} live-only
                  {summary.conflict > 0 ? ` · ${summary.conflict} conflict${summary.conflict === 1 ? '' : 's'}` : ''}
                </p>
              ) : null}
              {canReview && isOpen ? (
                <label className="flex flex-col gap-[var(--space-1)]">
                  <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                    Review note (optional)
                  </span>
                  <TextArea
                    value={reviewNote}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setReviewNote(e.target.value)
                    }
                    rows={2}
                    placeholder="Note for the author…"
                  />
                </label>
              ) : null}
            </CardBody>
          </Card>

          {isOpen && canReview ? (
            hunksQuery.isLoading ? (
              <ReviewLoading />
            ) : hunksQuery.isError ? (
              <ReviewError
                message="Couldn't load review hunks."
                onRetry={() => void hunksQuery.refetch()}
              />
            ) : hunks.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No changes to review</CardTitle>
                  <CardDescription>
                    The live page already matches this suggestion.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <div className="flex flex-col gap-[var(--space-4)]">
                {hunks.map((hunk) => (
                  <HunkCard
                    key={hunk.id}
                    hunk={hunk}
                    choice={resolvedChoices[hunk.id]}
                    onChoice={(side) => setHunkChoice(hunk.id, side)}
                    needsChoice={hunk.kind === 'conflict' && !choices[hunk.id]}
                  />
                ))}
              </div>
            )
          ) : !isOpen ? (
            <Card>
              <CardHeader>
                <CardTitle>Review closed</CardTitle>
                <CardDescription>
                  This suggestion is {suggestion.status}. No further action is needed.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Awaiting review</CardTitle>
                <CardDescription>
                  An editor will review your suggestion and merge or reject the
                  changes.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this suggestion?</DialogTitle>
            <DialogDescription>
              The author will be notified. You can leave an optional note below.
            </DialogDescription>
          </DialogHeader>
          <TextArea
            value={reviewNote}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setReviewNote(e.target.value)
            }
            rows={3}
            placeholder="Reason for rejection…"
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              onClick={handleReject}
              disabled={busy}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface HunkCardProps {
  hunk: SuggestionHunk
  choice: SuggestionHunkSide | undefined
  onChoice: (side: SuggestionHunkSide) => void
  needsChoice: boolean
}

function HunkCard({ hunk, choice, onChoice, needsChoice }: HunkCardProps) {
  const liveText = (hunk.live_lines ?? []).join('\n')
  const suggestionText = (hunk.suggestion_lines ?? []).join('\n')
  const fieldLabel =
    hunk.field === 'props' && hunk.props_key
      ? `Property: ${hunk.props_key}`
      : hunk.field === 'title'
        ? 'Title'
        : hunk.field === 'body'
          ? 'Body'
          : hunk.field

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-[var(--space-3)] flex-wrap">
          <div className="flex items-center gap-[var(--space-2)] flex-wrap min-w-0">
            <CardTitle className="text-[length:var(--text-base)]">{fieldLabel}</CardTitle>
            <HunkKindBadge kind={hunk.kind} />
            {needsChoice ? (
              <Badge variant="danger">Choose a side</Badge>
            ) : null}
          </div>
          <ToggleGroup
            type="single"
            value={choice}
            onValueChange={(next) => {
              if (next === 'suggestion' || next === 'live') onChoice(next)
            }}
            aria-label={`Choice for ${fieldLabel}`}
          >
            <ToggleGroupItem value="suggestion" size="sm">
              Accept suggestion
            </ToggleGroupItem>
            <ToggleGroupItem value="live" size="sm">
              Keep live
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardBody>
        {hunk.field === 'body' || hunk.field === 'title' ? (
          <DiffViewer
            oldBody={liveText}
            newBody={suggestionText}
            oldLabel="Live"
            newLabel="Suggestion"
            defaultMode="inline"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-[var(--space-3)] text-[length:var(--text-sm)] font-[family-name:var(--font-mono)]">
            <div>
              <p className="m-0 mb-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
                Live
              </p>
              <pre className="m-0 p-[var(--space-3)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] whitespace-pre-wrap break-words">
                {liveText || '—'}
              </pre>
            </div>
            <div>
              <p className="m-0 mb-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]">
                Suggestion
              </p>
              <pre className="m-0 p-[var(--space-3)] rounded-[var(--radius-sm)] bg-[var(--surface-2)] whitespace-pre-wrap break-words">
                {suggestionText || '—'}
              </pre>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function HunkKindBadge({ kind }: { kind: SuggestionHunk['kind'] }) {
  const label =
    kind === 'suggestion_only'
      ? 'Suggestion only'
      : kind === 'live_only'
        ? 'Live only'
        : kind === 'conflict'
          ? 'Conflict'
          : kind
  const variant = kind === 'conflict' ? 'danger' : 'muted'
  return <Badge variant={variant}>{label}</Badge>
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === 'open' ? 'accent' : status === 'approved' ? 'muted' : 'danger'
  return <Badge variant={variant}>{status}</Badge>
}

function ReviewBreadcrumb({
  spaceId,
  pageId,
  pageTitle,
  suggestionId,
}: {
  spaceId: number
  pageId: number
  pageTitle: string
  suggestionId: number
}) {
  const space = useSpace(spaceId)
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center min-w-0 text-[length:var(--text-sm)] text-[var(--text-muted)] font-[family-name:var(--font-sans)]"
    >
      <Link
        to="/spaces/$spaceId"
        params={{ spaceId }}
        className="truncate hover:text-[var(--text-primary)] hover:underline underline-offset-2"
      >
        {space.data?.name ?? 'Space'}
      </Link>
      <ChevronRight aria-hidden width={14} height={14} className="mx-[var(--space-1)] shrink-0" />
      <Link
        to="/spaces/$spaceId/pages/$pageId/{-$slug}"
        params={{ spaceId, pageId, slug: undefined }}
        className="truncate hover:text-[var(--text-primary)] hover:underline underline-offset-2"
      >
        {pageTitle || 'Untitled'}
      </Link>
      <ChevronRight aria-hidden width={14} height={14} className="mx-[var(--space-1)] shrink-0" />
      <span className="truncate text-[var(--text-primary)]" aria-current="page">
        Suggestion #{suggestionId}
      </span>
    </nav>
  )
}

function ReviewLoading() {
  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <div className="h-[var(--space-8)] w-1/2 rounded-[var(--radius-sm)] bg-[var(--surface-2)]" />
      <div className="h-[calc(var(--space-8)*6)] rounded-[var(--radius-md)] bg-[var(--surface-2)]" />
    </div>
  )
}

function ReviewError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-[var(--space-3)]">
      <p className="m-0 text-[length:var(--text-sm)] text-[var(--danger)]">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

function ReviewNotFound({ spaceId }: { spaceId: number }) {
  return (
    <div className="flex-1 flex items-center justify-center p-[var(--space-7)]">
      <div className="flex flex-col items-center gap-[var(--space-3)] text-center max-w-[28rem]">
        <h2 className="m-0 text-[length:var(--text-xl)] text-[var(--text-primary)]">
          Not found
        </h2>
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          This suggestion may have been withdrawn or the page moved.
        </p>
        <Button asChild variant="secondary">
          <Link to="/spaces/$spaceId" params={{ spaceId }}>
            Back to space
          </Link>
        </Button>
      </div>
    </div>
  )
}

function ReviewViewerDenied({
  spaceId,
  pageId,
}: {
  spaceId: number
  pageId: number
}) {
  return (
    <div className="flex-1 flex items-center justify-center p-[var(--space-7)]">
      <Card className="w-full max-w-[28rem] text-center">
        <CardHeader className="items-center">
          <CardTitle>Review is editor-only</CardTitle>
          <CardDescription>
            Only editors and owners can review suggestions. You can still submit
            suggestions from the page.
          </CardDescription>
        </CardHeader>
        <CardBody className="items-center">
          <Button asChild variant="secondary">
            <Link
              to="/spaces/$spaceId/pages/$pageId/{-$slug}"
              params={{ spaceId, pageId, slug: undefined }}
            >
              Back to page
            </Link>
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
