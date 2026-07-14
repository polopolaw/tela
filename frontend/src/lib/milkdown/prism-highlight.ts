import type { Node } from '@milkdown/prose/model'
import type { RootContent, Text } from 'hast'
import type { Refractor } from 'refractor/core'
import { findChildren } from '@milkdown/prose'
import { Decoration, DecorationSet } from '@milkdown/prose/view'
import { resolveCodeLang } from '../code-highlight'

interface FlattedNode {
  text: string
  className: string[]
}

function flatNodes(nodes: RootContent[], className: string[] = []) {
  return nodes.flatMap((node): FlattedNode[] =>
    node.type === 'element'
      ? flatNodes(node.children, [
          ...className,
          ...((node.properties?.className as string[]) || []),
        ])
      : [{ text: (node as Text).value, className }],
  )
}

/** Like @milkdown/plugin-prism getDecorations, but normalizes aliases and
 *  highlights blocks with no fence label via guessCodeLang. */
export function getPrismDecorations(doc: Node, name: string, refractor: Refractor) {
  const { highlight } = refractor
  const decorations: Decoration[] = []

  findChildren((node) => node.type.name === name)(doc).forEach((block) => {
    const resolved = resolveCodeLang(
      block.node.textContent,
      block.node.attrs.language as string | null,
      refractor,
    )
    if (!resolved) return

    let from = block.pos + 1
    const nodes = highlight(block.node.textContent, resolved)

    flatNodes(nodes.children).forEach((node) => {
      const to = from + node.text.length

      if (node.className.length) {
        decorations.push(
          Decoration.inline(from, to, {
            class: node.className.join(' '),
          }),
        )
      }

      from = to
    })
  })

  return DecorationSet.create(doc, decorations)
}
