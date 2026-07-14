import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { DrawIoEmbedRef, EventExport } from 'react-drawio'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/sheet'
import { api, ApiError } from '../../lib/api'
import {
  DRAWIO_EXPORT_FORMAT,
  pngBase64FromExport,
  xmlFromExport,
} from '../../lib/drawio/export'
import { computeDrawioSceneHash } from '../../lib/drawio/hash'

const DrawIoCanvas = lazy(() =>
  import('react-drawio').then((mod) => ({ default: mod.DrawIoEmbed })),
)

const DRAWIO_BASE_URL =
  (import.meta.env.VITE_DRAWIO_BASE_URL as string | undefined) ||
  'https://embed.diagrams.net'

interface DiagramPayload {
  sceneHash: string
  altText: string
  sceneJSON: string
  diagramId: string
}

export interface DrawioEditSheetProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  pageId: number
  initialXml: string
  initialAltText: string
  initialDiagramId: string
  onSave: (next: DiagramPayload) => void | Promise<void>
}

interface UploadResponse {
  scene_hash: string
  byte_size: number
  url: string
}

function parseInitialAltText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { alt_text?: unknown }
    return typeof parsed.alt_text === 'string' ? parsed.alt_text : ''
  } catch {
    return ''
  }
}

export function DrawioEditSheet({
  open,
  onOpenChange,
  pageId,
  initialXml,
  initialAltText: initialAltTextProp,
  initialDiagramId,
  onSave,
}: DrawioEditSheetProps) {
  const drawioRef = useRef<DrawIoEmbedRef>(null)
  const exportResolveRef = useRef<((ev: EventExport) => void) | null>(null)
  const latestXmlRef = useRef(initialXml)
  const [altText, setAltText] = useState(initialAltTextProp)
  const [settled, setSettled] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)

  useEffect(() => {
    if (!open) return
    setAltText(initialAltTextProp || parseInitialAltText(''))
    latestXmlRef.current = initialXml
    setSettled(false)
    setEditorReady(false)
    setStatus('idle')
    setErrorMessage(null)
  }, [open, initialXml, initialAltTextProp])

  useEffect(() => {
    if (!open) return
    const settle = () => setSettled(true)
    const content = document.querySelector('.tela-drawio-sheet-content')
    content?.addEventListener('animationend', settle)
    const fallback = window.setTimeout(settle, 450)
    return () => {
      content?.removeEventListener('animationend', settle)
      window.clearTimeout(fallback)
    }
  }, [open])

  useEffect(() => {
    if (!open || !editorReady || !settled) return
    if (initialXml) {
      drawioRef.current?.load({ xml: initialXml })
    }
  }, [open, editorReady, settled, initialXml])

  async function handleSave(): Promise<void> {
    setStatus('saving')
    setErrorMessage(null)
    try {
      const exportPromise = new Promise<EventExport>((resolve, reject) => {
        exportResolveRef.current = resolve
        window.setTimeout(() => {
          if (exportResolveRef.current === resolve) {
            exportResolveRef.current = null
            reject(new Error('Export timed out'))
          }
        }, 20_000)
      })

      drawioRef.current?.exportDiagram({
        format: DRAWIO_EXPORT_FORMAT,
        spin: true,
        border: '10',
        scale: 1,
      })

      const exported = await exportPromise
      const xml = xmlFromExport(exported, latestXmlRef.current)

      const sceneHash = await computeDrawioSceneHash(xml)
      const pngBase64 = pngBase64FromExport(exported.data)
      if (!pngBase64) {
        throw new Error('Export returned no image data')
      }
      await uploadDiagram(pageId, { scene_hash: sceneHash, png_base64: pngBase64 })

      const diagramId = initialDiagramId || crypto.randomUUID()
      const sceneJSON = JSON.stringify({
        scene_hash: sceneHash,
        alt_text: altText.trim(),
        diagram_id: diagramId,
        xml,
      })

      await onSave({ sceneHash, altText: altText.trim(), sceneJSON, diagramId })
      onOpenChange(false)
    } catch (err) {
      setStatus('error')
      setErrorMessage(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not save diagram',
      )
    }
  }

  function handleExport(ev: EventExport) {
    if (ev.event !== 'export') return
    latestXmlRef.current = ev.xml
    const resolve = exportResolveRef.current
    if (resolve) {
      exportResolveRef.current = null
      resolve(ev)
    }
  }

  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="tela-drawio-sheet-content !w-screen sm:!max-w-none flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader>
          <SheetTitle>Draw.io diagram</SheetTitle>
          <SheetDescription>
            Edit your diagram in the full draw.io editor. Save inserts a preview on the page.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex-1 min-h-0 flex flex-col gap-[var(--space-3)]">
          <div className="flex flex-col gap-[var(--space-2)] sm:flex-row sm:items-center">
            <label className="text-[length:var(--text-sm)] text-[color:var(--fg-muted)] shrink-0">
              Alt text
            </label>
            <Input
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Diagram description"
            />
          </div>
          <div className="flex-1 min-h-[50vh] rounded-[var(--radius-md)] overflow-hidden border border-[color:var(--border)]">
            {settled ? (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[color:var(--fg-muted)]">
                    Loading draw.io…
                  </div>
                }
              >
                <DrawIoCanvas
                  ref={drawioRef}
                  baseUrl={DRAWIO_BASE_URL}
                  autosave
                  exportFormat={DRAWIO_EXPORT_FORMAT}
                  urlParameters={{
                    ui: 'kennedy',
                    spin: true,
                    libraries: true,
                    saveAndExit: false,
                    noSaveBtn: true,
                    noExitBtn: true,
                    dark: isDark,
                  }}
                  onLoad={(ev) => {
                    latestXmlRef.current = ev.xml
                    setEditorReady(true)
                  }}
                  onAutoSave={(ev) => {
                    latestXmlRef.current = ev.xml
                  }}
                  onExport={handleExport}
                />
              </Suspense>
            ) : null}
          </div>
          {status === 'error' && errorMessage ? (
            <p className="text-[length:var(--text-sm)] text-[color:var(--danger)]">{errorMessage}</p>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={status === 'saving' || !editorReady}
          >
            {status === 'saving' ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

async function uploadDiagram(
  pageId: number,
  body: { scene_hash: string; png_base64: string },
): Promise<UploadResponse> {
  return api<UploadResponse>(`/api/pages/${pageId}/diagrams`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
