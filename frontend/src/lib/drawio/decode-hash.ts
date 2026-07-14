import { inflateRaw } from 'pako'

/**
 * Decode diagrams.net / draw.io URL hash payloads (#R…, #U…, etc.).
 * Returns XML, a remote URL to fetch, or null if unsupported.
 */
export type HashDecodeResult =
  | { kind: 'xml'; xml: string }
  | { kind: 'url'; url: string }
  | { kind: 'unsupported' }

function inflateBase64Url(data: string): string | null {
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const inflated = inflateRaw(bytes)
    return new TextDecoder().decode(inflated)
  } catch {
    return null
  }
}

export function decodeDiagramsNetHash(fragment: string): HashDecodeResult {
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!hash) return { kind: 'unsupported' }

  const prefix = hash[0]
  const payload = hash.slice(1)

  switch (prefix) {
    case 'R': {
      const xml = inflateBase64Url(decodeURIComponent(payload))
      return xml ? { kind: 'xml', xml } : { kind: 'unsupported' }
    }
    case 'U': {
      try {
        const url = decodeURIComponent(payload)
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return { kind: 'url', url }
        }
      } catch {
        /* fall through */
      }
      return { kind: 'unsupported' }
    }
    default:
      return { kind: 'unsupported' }
  }
}
