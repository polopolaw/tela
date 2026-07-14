/** SHA256(content) truncated to 32 lowercase hex chars — matches page_diagrams validation. */
export async function computeDrawioSceneHash(xml: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(xml))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

export const SCENE_HASH_RE = /^[a-f0-9]{8,64}$/

export function isDrawioXml(text: string): boolean {
  const t = text.trim()
  return t.includes('<mxfile') || t.includes('<mxGraphModel')
}
