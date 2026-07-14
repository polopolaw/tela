// Pure, Milkdown-free parsing of ```drawio fences. Shared by the editor and
// MarkdownView (see docs/view-edit-split.md).

import { isDrawioXml, SCENE_HASH_RE } from '../../drawio/hash'

export interface MdastNode {
  type: string
  value?: string
  lang?: string
  children?: MdastNode[]
  sceneHash?: string
  altText?: string
  sceneJSON?: string
  diagramId?: string
  [k: string]: unknown
}

interface DrawioSceneJSON {
  scene_hash?: unknown
  alt_text?: unknown
  diagram_id?: unknown
  xml?: unknown
  [k: string]: unknown
}

const EMPTY_SCENE_JSON = JSON.stringify({
  scene_hash: '',
  alt_text: '',
  diagram_id: '',
  xml: '',
})

export function transformDrawioInMdast(node: MdastNode): void {
  if (
    node.type === 'code' &&
    typeof node.lang === 'string' &&
    node.lang === 'drawio' &&
    typeof node.value === 'string'
  ) {
    const raw = node.value
    let parsed: DrawioSceneJSON | null
    try {
      parsed = JSON.parse(raw) as DrawioSceneJSON
    } catch {
      parsed = null
    }
    if (parsed && typeof parsed === 'object') {
      const sceneHash = typeof parsed.scene_hash === 'string' ? parsed.scene_hash : ''
      const altText = typeof parsed.alt_text === 'string' ? parsed.alt_text : ''
      const diagramId = typeof parsed.diagram_id === 'string' ? parsed.diagram_id : ''
      const xml = typeof parsed.xml === 'string' ? parsed.xml : ''
      const validHash = SCENE_HASH_RE.test(sceneHash)
      const hasXml = isDrawioXml(xml)
      if (validHash || hasXml) {
        node.type = 'drawio'
        node.sceneHash = validHash ? sceneHash : ''
        node.altText = altText
        node.diagramId = diagramId
        node.sceneJSON = raw
        delete node.lang
        delete node.value
        return
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      transformDrawioInMdast(child)
    }
  }
}

export function drawioRemark() {
  return (tree: unknown) => {
    transformDrawioInMdast(tree as unknown as MdastNode)
  }
}

export { EMPTY_SCENE_JSON as DRAWIO_EMPTY_SCENE_JSON }
