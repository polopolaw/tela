import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { fetchPlantumlSvg, PlantumlRenderError } from '../../lib/diagrams/plantuml'

export interface PlantumlEditSheetProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  initialCode: string
  onSave: (code: string) => void
}

export function PlantumlEditSheet({
  open,
  onOpenChange,
  initialCode,
  onSave,
}: PlantumlEditSheetProps) {
  const [draft, setDraft] = useState(initialCode)
  const [debounced, setDebounced] = useState(initialCode)
  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [settled, setSettled] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    setDraft(initialCode)
    setDebounced(initialCode)
    setPreviewSvg(null)
    setPreviewError(null)
    setSettled(false)
  }, [open, initialCode])

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => setDebounced(draft), 400)
    return () => window.clearTimeout(t)
  }, [draft, open])

  useEffect(() => {
    if (!open || !settled) return
    const source = debounced.trim()
    if (!source) {
      setPreviewSvg(null)
      setPreviewError(null)
      setRendering(false)
      return
    }
    const id = ++requestId.current
    setRendering(true)
    void fetchPlantumlSvg(source)
      .then((svg) => {
        if (id !== requestId.current) return
        setPreviewSvg(svg)
        setPreviewError(null)
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return
        setPreviewSvg((prev) => prev)
        setPreviewError(
          err instanceof PlantumlRenderError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not render diagram',
        )
      })
      .finally(() => {
        if (id === requestId.current) setRendering(false)
      })
  }, [debounced, open, settled])

  const handleOpenChange = (next: boolean) => {
    if (!next) onOpenChange(false)
  }

  const handleSave = () => {
    onSave(draft)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="!w-screen sm:!max-w-none flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onAnimationEnd={() => setSettled(true)}
      >
        <SheetHeader>
          <SheetTitle>PlantUML diagram</SheetTitle>
          <SheetDescription>
            Edit source on the left; preview updates automatically on the right.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="min-h-0 flex-1">
          <div className="tela-plantuml-sheet-grid h-full min-h-0">
            <label className="flex min-h-0 flex-col gap-[var(--space-2)]">
              <span className="text-[var(--text-sm)] text-[var(--text-muted)]">Source</span>
              <textarea
                className="tela-plantuml-sheet-code min-h-0 flex-1 resize-none"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </label>
            <div className="flex min-h-0 flex-col gap-[var(--space-2)]">
              <span className="text-[var(--text-sm)] text-[var(--text-muted)]">Preview</span>
              <div
                className="tela-plantuml-sheet-preview min-h-0 flex-1 overflow-auto"
                aria-busy={rendering}
              >
                {previewError ? (
                  <p className="tela-plantuml-error">{previewError}</p>
                ) : previewSvg ? (
                  <div
                    className="tela-plantuml"
                    dangerouslySetInnerHTML={{ __html: previewSvg }}
                  />
                ) : (
                  <p className="text-[var(--text-muted)]">
                    {debounced.trim() ? 'Rendering diagram…' : 'Enter PlantUML source to preview.'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
