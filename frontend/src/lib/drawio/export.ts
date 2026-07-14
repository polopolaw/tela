import type { EventExport } from 'react-drawio'

/** draw.io embed `png` export often never responds; `xmlpng` returns a PNG data URL reliably. */
export const DRAWIO_EXPORT_FORMAT = 'xmlpng' as const

export function pngBase64FromExport(data: string): string {
  const comma = data.indexOf(',')
  if (data.startsWith('data:') && comma !== -1) {
    return data.slice(comma + 1)
  }
  return data
}

export function xmlFromExport(ev: EventExport, fallbackXml: string): string {
  const xml = (ev.xml || fallbackXml).trim()
  if (!xml) {
    throw new Error('Diagram is empty')
  }
  return xml
}
