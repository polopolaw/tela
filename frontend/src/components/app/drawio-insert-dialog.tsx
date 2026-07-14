import { useState } from 'react'
import type { Ctx } from '@milkdown/ctx'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { DrawioImportError, resolveDrawioImport } from '../../lib/drawio/import-url'
import { insertDrawioWithXml } from './milkdown-drawio'

export interface DrawioInsertDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  runWithCtx: (fn: (ctx: Ctx) => void) => void
}

export function DrawioInsertDialog({ open, onOpenChange, runWithCtx }: DrawioInsertDialogProps) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setUrl('')
    setError(null)
    setLoading(false)
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  function insertBlank() {
    runWithCtx((ctx) => insertDrawioWithXml(ctx, ''))
    handleOpenChange(false)
  }

  async function handleImport() {
    setLoading(true)
    setError(null)
    try {
      const xml = await resolveDrawioImport(url)
      runWithCtx((ctx) => insertDrawioWithXml(ctx, xml))
      handleOpenChange(false)
    } catch (err) {
      setError(
        err instanceof DrawioImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Import failed',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insert Draw.io diagram</DialogTitle>
          <DialogDescription>
            Start a blank diagram or import an existing one from a link (diagrams.net, Google
            Drive, or a direct .drawio / XML URL).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[var(--space-3)]">
          <Button type="button" onClick={insertBlank}>
            New blank diagram
          </Button>
          <div className="flex flex-col gap-[var(--space-2)]">
            <label
              htmlFor="drawio-import-url"
              className="text-[length:var(--text-sm)] text-[color:var(--fg-muted)]"
            >
              Import from URL
            </label>
            <Input
              id="drawio-import-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://viewer.diagrams.net/… or Google Drive link"
              disabled={loading}
            />
          </div>
          {error ? (
            <p className="text-[length:var(--text-sm)] text-[color:var(--danger)]">{error}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleImport()}
            disabled={loading || !url.trim()}
          >
            {loading ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
