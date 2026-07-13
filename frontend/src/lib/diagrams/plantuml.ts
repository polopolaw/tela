// Milkdown-free PlantUML render core. Kroki renders server-side via the backend
// proxy (POST /api/render/plantuml and context-specific public variants).

const svgCache = new Map<string, string>()

export class PlantumlRenderError extends Error {
  readonly code: string
  readonly status: number

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'PlantumlRenderError'
    this.status = status
    this.code = code
  }
}

/** Resolve the render endpoint from the current reader context. */
export function plantumlRenderEndpoint(): string {
  if (typeof window === 'undefined') return '/api/render/plantuml'
  const path = window.location.pathname
  const printMatch = path.match(/^\/print\/([^/]+)/)
  if (printMatch) {
    return `/api/print/${encodeURIComponent(printMatch[1])}/render/plantuml`
  }
  const shareMatch = path.match(/^\/share\/([^/]+)/)
  if (shareMatch) {
    return `/api/share/${encodeURIComponent(shareMatch[1])}/render/plantuml`
  }
  const publicMatch = path.match(/^\/public\/spaces\/(\d+)/)
  if (publicMatch) {
    return `/api/public/spaces/${publicMatch[1]}/render/plantuml`
  }
  return '/api/render/plantuml'
}

export async function fetchPlantumlSvg(source: string): Promise<string> {
  const key = plantumlRenderEndpoint() + '\n' + source
  const cached = svgCache.get(key)
  if (cached) return cached

  const res = await fetch(plantumlRenderEndpoint(), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source }),
  })
  if (!res.ok) {
    let code = 'plantuml_render_failed'
    let message = `Could not render diagram (${res.status})`
    try {
      const body = (await res.json()) as { code?: string; error?: string }
      if (body.code) code = body.code
      if (body.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    throw new PlantumlRenderError(res.status, code, message)
  }
  const svg = await res.text()
  svgCache.set(key, svg)
  return svg
}

export function buildPlantumlElement(code: string): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'tela-plantuml'
  dom.setAttribute('contenteditable', 'false')

  const render = () => {
    if (!code.trim()) {
      dom.classList.remove('tela-plantuml-error')
      dom.textContent = ''
      return
    }
    const key = plantumlRenderEndpoint() + '\n' + code
    const cached = svgCache.get(key)
    if (cached) {
      dom.classList.remove('tela-plantuml-error')
      dom.innerHTML = cached
      return
    }
    if (!dom.innerHTML) dom.textContent = 'Rendering diagram…'
    void fetchPlantumlSvg(code)
      .then((svg) => {
        dom.classList.remove('tela-plantuml-error')
        dom.innerHTML = svg
      })
      .catch((err: unknown) => {
        dom.classList.add('tela-plantuml-error')
        dom.textContent =
          err instanceof PlantumlRenderError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not render diagram'
      })
  }
  render()
  return dom
}
