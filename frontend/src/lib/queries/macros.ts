import { useQuery } from '@tanstack/react-query'
import { api } from '../api'

export interface MacroPayload {
  macro_id: string
  page_id: number
  space_id: number
  title: string
  body: string
  updated_at: string
}

export interface PageIncludePayload {
  page_id: number
  title: string
  body: string
  updated_at: string
}

export interface MacroListItem {
  macro_id: string
  page_id: number
  title: string
  body: string
  updated_at: string
}

export interface MacroSurface {
  shareToken?: string
  publicSpaceId?: number
}

export const macroKeys = {
  all: ['macros'] as const,
  detail: (id: string, surface: MacroSurface = {}) =>
    [...macroKeys.all, 'detail', id, surface.shareToken ?? '', surface.publicSpaceId ?? 0] as const,
  pageInclude: (pageId: number, surface: MacroSurface = {}) =>
    [...macroKeys.all, 'page-include', pageId, surface.shareToken ?? '', surface.publicSpaceId ?? 0] as const,
  list: (spaceId: number, query?: string) =>
    [...macroKeys.all, 'list', spaceId, query ?? ''] as const,
}

async function macroJsonFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    let code = 'error'
    let message = res.statusText
    try {
      const body = (await res.json()) as { code?: string; message?: string }
      code = body.code ?? code
      message = body.message ?? message
    } catch {
      /* ignore */
    }
    const err = new Error(message) as Error & { status: number; code: string }
    err.status = res.status
    err.code = code
    throw err
  }
  return res.json() as Promise<T>
}

function macroUrl(macroId: string, surface: MacroSurface): string {
  if (surface.shareToken) {
    return `/api/share/${encodeURIComponent(surface.shareToken)}/macros/${encodeURIComponent(macroId)}`
  }
  if (surface.publicSpaceId) {
    return `/api/public/spaces/${surface.publicSpaceId}/macros/${encodeURIComponent(macroId)}`
  }
  return `/api/macros/${encodeURIComponent(macroId)}`
}

function pageIncludeUrl(pageId: number, surface: MacroSurface): string {
  if (surface.shareToken) {
    return `/api/share/${encodeURIComponent(surface.shareToken)}/page/${pageId}/include`
  }
  if (surface.publicSpaceId) {
    return `/api/public/spaces/${surface.publicSpaceId}/pages/${pageId}/include`
  }
  return `/api/pages/${pageId}/include`
}

export async function fetchMacro(
  macroId: string,
  surface: MacroSurface = {},
): Promise<MacroPayload> {
  const useSession = !surface.shareToken && !surface.publicSpaceId
  const path = macroUrl(macroId, surface)
  if (useSession) {
    const data = await api<{ macro: MacroPayload }>(path)
    return data.macro
  }
  const data = await macroJsonFetch<{ macro: MacroPayload }>(path)
  return data.macro
}

export async function fetchPageInclude(
  pageId: number,
  surface: MacroSurface = {},
): Promise<PageIncludePayload> {
  const useSession = !surface.shareToken && !surface.publicSpaceId
  const path = pageIncludeUrl(pageId, surface)
  if (useSession) {
    const data = await api<{ include: PageIncludePayload }>(path)
    return data.include
  }
  const data = await macroJsonFetch<{ include: PageIncludePayload }>(path)
  return data.include
}

export async function fetchMacroList(
  spaceId: number,
  query = '',
): Promise<MacroListItem[]> {
  const params = new URLSearchParams({ space_id: String(spaceId) })
  const q = query.trim()
  if (q) params.set('q', q)
  const data = await api<{ macros: MacroListItem[] }>(
    `/api/macros?${params.toString()}`,
  )
  return data.macros
}

export function useMacro(
  macroId: string | null | undefined,
  surface: MacroSurface = {},
) {
  return useQuery({
    queryKey: macroKeys.detail(macroId ?? '', surface),
    enabled: !!macroId,
    staleTime: 30_000,
    queryFn: () => fetchMacro(macroId!, surface),
  })
}

export function usePageInclude(
  pageId: number | null | undefined,
  surface: MacroSurface = {},
) {
  return useQuery({
    queryKey: macroKeys.pageInclude(pageId ?? 0, surface),
    enabled: !!pageId && pageId > 0,
    staleTime: 30_000,
    queryFn: () => fetchPageInclude(pageId!, surface),
  })
}

export function useMacroList(
  spaceId: number | null | undefined,
  query = '',
) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: macroKeys.list(spaceId ?? 0, trimmed),
    enabled: !!spaceId,
    staleTime: 60_000,
    queryFn: () => fetchMacroList(spaceId!, trimmed),
  })
}

export const MACRO_MAX_DEPTH = 8

export function newMacroId(): string {
  return `m_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
}
