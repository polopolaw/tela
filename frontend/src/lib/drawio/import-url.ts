import { api, ApiError } from '../api'
import { isDrawioXml } from './hash'
import { decodeDiagramsNetHash } from './decode-hash'

export class DrawioImportError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'DrawioImportError'
    this.code = code
  }
}

interface ImportResponse {
  xml: string
  title?: string
}

function normalizeGoogleDriveUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (!u.hostname.endsWith('google.com')) return null
    const m = u.pathname.match(/\/file\/d\/([^/]+)/)
    if (!m) return null
    return `https://drive.google.com/uc?export=download&id=${m[1]}`
  } catch {
    return null
  }
}

function parseDiagramsNetPageUrl(url: string): HashDecodeResult | null {
  try {
    const u = new URL(url)
    const host = u.hostname
    if (
      host === 'app.diagrams.net' ||
      host === 'viewer.diagrams.net' ||
      host === 'embed.diagrams.net' ||
      host.endsWith('.draw.io')
    ) {
      if (u.hash) return decodeDiagramsNetHash(u.hash)
    }
  } catch {
    return null
  }
  return null
}

type HashDecodeResult = ReturnType<typeof decodeDiagramsNetHash>

async function fetchRemoteXml(url: string): Promise<string> {
  let res: ImportResponse
  try {
    res = await api<ImportResponse>('/api/drawio/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
  } catch (err) {
    if (err instanceof ApiError) {
      throw new DrawioImportError(err.message, err.code)
    }
    throw err
  }
  if (!res.xml || !isDrawioXml(res.xml)) {
    throw new DrawioImportError('Response is not a draw.io diagram', 'not_a_diagram')
  }
  return res.xml
}

/**
 * Resolve a user-supplied URL or raw XML into draw.io mxfile XML.
 */
export async function resolveDrawioImport(input: string): Promise<string> {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new DrawioImportError('URL is required', 'bad_request')
  }

  if (isDrawioXml(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new DrawioImportError('Invalid URL', 'bad_request')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DrawioImportError('Only http(s) URLs are supported', 'unsupported_url')
  }

  const fromHash = parseDiagramsNetPageUrl(trimmed)
  if (fromHash) {
    if (fromHash.kind === 'xml') return fromHash.xml
    if (fromHash.kind === 'url') return fetchRemoteXml(fromHash.url)
  }

  const driveUrl = normalizeGoogleDriveUrl(trimmed)
  if (driveUrl) return fetchRemoteXml(driveUrl)

  return fetchRemoteXml(trimmed)
}
