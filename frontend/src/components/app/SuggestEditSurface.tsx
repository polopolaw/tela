import { Suspense, lazy, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronRight, GitPullRequest } from 'lucide-react'
import { useCreatePageSuggestion } from '../../lib/queries/page-suggestions'
import { useSpace } from '../../lib/queries/spaces'
import { prefetchMilkdownEditor } from '../../lib/prefetchEditor'
import type { Page } from '../../lib/types'
import { Button } from '../ui/button'
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
import { toast } from '../ui/toast'
import { cn } from '../../lib/utils'

const MilkdownEditor = lazy(() =>
  import('./milkdown-editor').then((m) => ({ default: m.MilkdownEditor })),
)

const EDITOR_MIN_H = 'min-h-[calc(var(--space-8)*8)]'

function EditorFallback() {
  return (
    <div
      className={cn(EDITOR_MIN_H, 'rounded-[var(--radius-md)] bg-[var(--surface-2)]')}
      aria-hidden
    />
  )
}

interface SuggestEditSurfaceProps {
  page: Page
  spaceId: number
  onCancel: () => void
  isViewer: boolean
}

export function SuggestEditSurface({
  page,
  spaceId,
  onCancel,
  isViewer,
}: SuggestEditSurfaceProps) {
  const navigate = useNavigate()
  const createSuggestion = useCreatePageSuggestion()
  const [title, setTitle] = useState(page.title)
  const [body, setBody] = useState(page.body)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const titleRef = useRef<HTMLTextAreaElement>(null)

  const fitTitleHeight = useCallback(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(fitTitleHeight, [fitTitleHeight, title])

  const hasChanges = title !== page.title || body !== page.body

  const handleSubmit = () => {
    if (!hasChanges) {
      toast({
        variant: 'destructive',
        title: 'No changes',
        description: 'Edit the title or body before submitting a suggestion.',
      })
      return
    }
    setSummaryOpen(true)
  }

  const handleConfirmSubmit = () => {
    void createSuggestion
      .mutateAsync({
        pageId: page.id,
        title: title !== page.title ? title : undefined,
        body,
        summary: summary.trim() || undefined,
      })
      .then((suggestion) => {
        setSummaryOpen(false)
        toast({
          variant: 'success',
          title: 'Suggestion submitted',
          description: isViewer
            ? 'Track your suggestion on the review page.'
            : 'Open the review page to merge your suggestion.',
          duration: 6000,
        })
        void navigate({
          to: '/spaces/$spaceId/pages/$pageId/suggestions/$suggestionId',
          params: {
            spaceId,
            pageId: page.id,
            suggestionId: suggestion.id,
          },
        })
      })
      .catch(() => {
        toast({
          variant: 'destructive',
          title: "Couldn't submit suggestion",
          description: 'Please try again.',
        })
      })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="flex items-center justify-between gap-[var(--space-4)] px-[var(--space-6)] py-[var(--space-3)] border-b border-[var(--border-subtle)] shrink-0">
        <SuggestBreadcrumb spaceId={spaceId} pageTitle={page.title} />
        <div className="flex items-center gap-[var(--space-2)]">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={createSuggestion.isPending || !hasChanges}
          >
            Submit suggestion
          </Button>
        </div>
      </header>

      <div
        data-page-scroll
        className="flex-1 overflow-y-auto min-h-0"
        onMouseEnter={prefetchMilkdownEditor}
      >
        <div className="flex flex-col gap-[var(--space-4)] p-[var(--space-7)] max-w-[56rem] w-full mx-auto min-h-full">
          <div
            role="status"
            className={cn(
              'flex items-center gap-[var(--space-2)]',
              'bg-[var(--surface-2)] border border-[var(--border-subtle)]',
              'rounded-[var(--radius-sm)]',
              'px-[var(--space-3)] py-[var(--space-2)]',
              'text-[length:var(--text-sm)] text-[var(--text-muted)]',
            )}
          >
            <GitPullRequest aria-hidden width={14} height={14} />
            <span>
              Suggest an edit — your changes won't be published until an editor
              reviews them.
            </span>
          </div>

          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled page"
            aria-label="Suggested title"
            className={cn(
              'block w-full shrink-0 resize-none overflow-hidden bg-transparent',
              'rounded-[var(--radius-md)] border border-transparent outline-none',
              'px-[var(--space-2)] py-[var(--space-2)]',
              'text-[length:var(--text-3xl)] leading-[var(--leading-tight)] font-medium',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'focus-visible:border-[var(--border-subtle)]',
            )}
          />

          <Suspense fallback={<EditorFallback />}>
            <MilkdownEditor
              key={`suggest-${page.id}`}
              defaultValue={page.body}
              onChange={setBody}
              ariaLabel="Suggested body"
              className={EDITOR_MIN_H}
              collabPageId={null}
              readOnly={false}
              pageId={page.id}
              spaceId={spaceId}
            />
          </Suspense>
        </div>
      </div>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit suggestion</DialogTitle>
            <DialogDescription>
              Add an optional summary to help reviewers understand your changes.
            </DialogDescription>
          </DialogHeader>
          <TextArea
            value={summary}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSummary(e.target.value)}
            rows={3}
            placeholder="What changed and why?"
            autoFocus
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Back
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmSubmit}
              disabled={createSuggestion.isPending}
            >
              {createSuggestion.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SuggestBreadcrumb({
  spaceId,
  pageTitle,
}: {
  spaceId: number
  pageTitle: string
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
      <ChevronRight
        aria-hidden
        width={14}
        height={14}
        className="mx-[var(--space-1)] shrink-0"
      />
      <span className="truncate text-[var(--text-primary)]" aria-current="page">
        {pageTitle || 'Untitled'} · Suggest edit
      </span>
    </nav>
  )
}

/** Header button to enter suggest-edit mode (viewers required; editors optional). */
export function SuggestEditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      onMouseEnter={prefetchMilkdownEditor}
      onFocus={prefetchMilkdownEditor}
      className="h-[var(--space-8)] px-[var(--space-3)]"
    >
      <GitPullRequest width={16} height={16} />
      <span>Suggest edit</span>
    </Button>
  )
}
