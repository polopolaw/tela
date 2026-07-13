import { pageSlug } from '../slug'

export interface TocEntry {
  id: string
  text: string
  level: number
}

export interface StampHeadingAnchorsResult {
  entries: TocEntry[]
  headings: HTMLElement[]
}

const DEFAULT_LEVELS = 5

function headingSelector(levels: number): string {
  return Array.from({ length: levels }, (_, i) => `h${i + 1}`).join(', ')
}

/** Slug for a wikilink / URL fragment — same algorithm as heading ids. */
export function headingHashFromFragment(fragment: string): string {
  const raw = fragment.trim()
  if (!raw) return ''
  try {
    return pageSlug(decodeURIComponent(raw)) || raw
  } catch {
    return pageSlug(raw) || raw
  }
}

/**
 * Stamp stable slug ids + hover copy-link anchors on rendered headings.
 * Returns TOC entries and the stamped heading elements (for scroll-spy).
 */
export function stampHeadingAnchors(
  root: HTMLElement,
  options?: { levels?: number },
): StampHeadingAnchorsResult {
  const levels = options?.levels ?? DEFAULT_LEVELS
  const els = Array.from(
    root.querySelectorAll(headingSelector(levels)),
  ) as HTMLElement[]
  const entries: TocEntry[] = []
  const used = new Map<string, number>()

  els.forEach((el, i) => {
    const text = (el.textContent ?? '').trim()
    if (!text) return
    const base = pageSlug(text) || `section-${i + 1}`
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    el.id = n === 0 ? base : `${base}-${n + 1}`
    el.classList.add('reader-heading')

    if (!el.querySelector(':scope > .reader-anchor')) {
      const a = document.createElement('a')
      a.className = 'reader-anchor'
      a.href = `#${el.id}`
      a.textContent = '#'
      a.setAttribute('contenteditable', 'false')
      a.setAttribute('aria-label', 'Copy link to this section')
      el.prepend(a)
    } else {
      const a = el.querySelector(':scope > .reader-anchor') as HTMLElement
      a.setAttribute('href', `#${el.id}`)
    }
    entries.push({ id: el.id, text, level: Number(el.tagName[1]) })
  })

  const headings = els.filter((el) => el.id && el.textContent?.trim())
  return { entries, headings }
}

export function scrollToHeading(
  id: string,
  options?: { flash?: boolean; behavior?: ScrollBehavior },
): void {
  const el = document.getElementById(id)
  if (!el) return
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const behavior =
    options?.behavior ?? (reduce ? 'auto' : 'smooth')
  el.scrollIntoView({ behavior, block: 'start' })
  if (options?.flash) {
    el.classList.remove('reader-fn-flash')
    void el.offsetWidth
    el.classList.add('reader-fn-flash')
    window.setTimeout(() => el.classList.remove('reader-fn-flash'), 1400)
  }
}

/** Scroll to the current URL hash if a stamped heading exists. */
export function scrollToLocationHash(): void {
  const hash = decodeURIComponent(window.location.hash.slice(1))
  if (hash) scrollToHeading(hash)
}

/**
 * Copy-link handler for `.reader-anchor` clicks. Returns true when handled.
 */
export function handleReaderAnchorClick(
  anchor: HTMLAnchorElement,
  jumpTo: (id: string) => void,
): void {
  const hash = anchor.getAttribute('href') ?? ''
  const url = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`
  void navigator.clipboard?.writeText(url).catch(() => {})
  window.history.replaceState(null, '', url)
  jumpTo(hash.slice(1))
  anchor.dataset.copied = 'true'
  window.setTimeout(() => delete anchor.dataset.copied, 1100)
}
