import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { notificationKeys } from './notifications'
import { pageKeys } from './pages'

// Page suggestions (MR-like review). Mirrors backend models.PageSuggestion and
// merge.Hunk — see backend/internal/api/page_suggestions.go.

export interface PageSuggestion {
  id: number
  page_id: number
  author_id: number
  author_username?: string | null
  title?: string | null
  body: string
  props?: Record<string, unknown>
  base_revision_id?: number | null
  status: string
  summary?: string | null
  review_note?: string | null
  reviewed_by?: number | null
  reviewed_by_username?: string | null
  reviewed_at?: string | null
  created_at: string
  updated_at: string
}

export type SuggestionHunkKind =
  | 'suggestion_only'
  | 'live_only'
  | 'both_same'
  | 'conflict'

export type SuggestionHunkSide = 'suggestion' | 'live'

export interface SuggestionHunk {
  id: string
  kind: SuggestionHunkKind
  field: string
  props_key?: string
  base_lines?: string[]
  live_lines?: string[]
  suggestion_lines?: string[]
  default: SuggestionHunkSide
}

export interface SuggestionHunksSummary {
  suggestion_only: number
  live_only: number
  both_same: number
  conflict: number
}

export interface CreatePageSuggestionInput {
  pageId: number
  title?: string
  body: string
  props?: Record<string, unknown>
  summary?: string
}

export interface ApplySuggestionInput {
  suggestionId: number
  mode: 'full' | 'partial'
  choices?: Record<string, SuggestionHunkSide>
  review_note?: string
}

export interface SpaceSuggestionSummary {
  id: number
  page_id: number
  page_title: string
  author_username?: string | null
  summary?: string | null
  created_at: string
  status: string
}

export const suggestionKeys = {
  all: ['suggestions'] as const,
  page: (pageId: number, status?: string) =>
    [...suggestionKeys.all, 'page', pageId, status ?? 'all'] as const,
  space: (spaceId: number, status?: string) =>
    [...suggestionKeys.all, 'space', spaceId, status ?? 'all'] as const,
  detail: (id: number) => [...suggestionKeys.all, 'detail', id] as const,
  hunks: (id: number) => [...suggestionKeys.detail(id), 'hunks'] as const,
}

interface UsePageSuggestionsArgs {
  pageId: number | null | undefined
  status?: string
  enabled?: boolean
}

interface UseSpaceSuggestionsArgs {
  spaceId: number | null | undefined
  status?: string
  enabled?: boolean
}

export function useSpaceSuggestions({
  spaceId,
  status = 'open',
  enabled = true,
}: UseSpaceSuggestionsArgs) {
  return useQuery({
    queryKey:
      spaceId != null
        ? suggestionKeys.space(spaceId, status)
        : suggestionKeys.space(-1, status),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      const qs = params.toString()
      const { suggestions } = await api<{ suggestions: SpaceSuggestionSummary[] }>(
        `/api/spaces/${spaceId}/suggestions${qs ? `?${qs}` : ''}`,
      )
      return suggestions
    },
    enabled: enabled && spaceId != null,
  })
}

export function usePageSuggestions({
  pageId,
  status = 'open',
  enabled = true,
}: UsePageSuggestionsArgs) {
  return useQuery({
    queryKey:
      pageId != null
        ? suggestionKeys.page(pageId, status)
        : suggestionKeys.page(-1, status),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      const qs = params.toString()
      const { suggestions } = await api<{ suggestions: PageSuggestion[] }>(
        `/api/pages/${pageId}/suggestions${qs ? `?${qs}` : ''}`,
      )
      return suggestions
    },
    enabled: enabled && pageId != null,
  })
}

interface UseSuggestionArgs {
  suggestionId: number | null | undefined
  enabled?: boolean
}

export function useSuggestion({ suggestionId, enabled = true }: UseSuggestionArgs) {
  return useQuery({
    queryKey:
      suggestionId != null
        ? suggestionKeys.detail(suggestionId)
        : suggestionKeys.detail(-1),
    queryFn: async () => {
      const { suggestion } = await api<{ suggestion: PageSuggestion }>(
        `/api/suggestions/${suggestionId}`,
      )
      return suggestion
    },
    enabled: enabled && suggestionId != null,
  })
}

export function useSuggestionHunks({
  suggestionId,
  enabled = true,
}: UseSuggestionArgs) {
  return useQuery({
    queryKey:
      suggestionId != null
        ? suggestionKeys.hunks(suggestionId)
        : suggestionKeys.hunks(-1),
    queryFn: async () => {
      const { hunks, summary } = await api<{
        hunks: SuggestionHunk[]
        summary: SuggestionHunksSummary
      }>(`/api/suggestions/${suggestionId}/hunks`)
      return { hunks, summary }
    },
    enabled: enabled && suggestionId != null,
  })
}

function invalidateSuggestionQueries(
  qc: ReturnType<typeof useQueryClient>,
  pageId: number,
  suggestionId?: number,
) {
  void qc.invalidateQueries({ queryKey: suggestionKeys.page(pageId) })
  void qc.invalidateQueries({ queryKey: suggestionKeys.all })
  void qc.invalidateQueries({ queryKey: [...suggestionKeys.all, 'space'] })
  void qc.invalidateQueries({ queryKey: pageKeys.detail(pageId) })
  void qc.invalidateQueries({ queryKey: notificationKeys.all })
  if (suggestionId != null) {
    void qc.invalidateQueries({ queryKey: suggestionKeys.detail(suggestionId) })
    void qc.invalidateQueries({ queryKey: suggestionKeys.hunks(suggestionId) })
  }
}

export function useCreatePageSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePageSuggestionInput) => {
      const { pageId, title, body, props, summary } = input
      const payload: Record<string, unknown> = { body }
      if (title !== undefined) payload.title = title
      if (props !== undefined) payload.props = props
      if (summary !== undefined) payload.summary = summary
      const { suggestion } = await api<{ suggestion: PageSuggestion }>(
        `/api/pages/${pageId}/suggestions`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      return suggestion
    },
    onSuccess: (suggestion) => {
      invalidateSuggestionQueries(qc, suggestion.page_id, suggestion.id)
    },
  })
}

export function useApplySuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ApplySuggestionInput) => {
      const { suggestion } = await api<{ suggestion: PageSuggestion }>(
        `/api/suggestions/${input.suggestionId}/apply`,
        {
          method: 'POST',
          body: JSON.stringify({
            mode: input.mode,
            choices: input.choices,
            review_note: input.review_note,
          }),
        },
      )
      return suggestion
    },
    onSuccess: (suggestion) => {
      invalidateSuggestionQueries(qc, suggestion.page_id, suggestion.id)
    },
  })
}

export function useRejectSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      suggestionId: number
      pageId: number
      review_note?: string
    }) => {
      const { suggestion } = await api<{ suggestion: PageSuggestion }>(
        `/api/suggestions/${input.suggestionId}/reject`,
        {
          method: 'POST',
          body: JSON.stringify({ review_note: input.review_note }),
        },
      )
      return suggestion
    },
    onSuccess: (suggestion, input) => {
      invalidateSuggestionQueries(
        qc,
        suggestion.page_id ?? input.pageId,
        suggestion.id ?? input.suggestionId,
      )
    },
  })
}

export function useWithdrawSuggestion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { suggestionId: number; pageId: number }) => {
      const { suggestion } = await api<{ suggestion: PageSuggestion }>(
        `/api/suggestions/${input.suggestionId}/withdraw`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      return suggestion
    },
    onSuccess: (suggestion, input) => {
      invalidateSuggestionQueries(
        qc,
        suggestion.page_id ?? input.pageId,
        suggestion.id ?? input.suggestionId,
      )
    },
  })
}
