import type { MilkdownPlugin } from '@milkdown/ctx'
import type { Refractor } from 'refractor/core'
import { findChildren } from '@milkdown/prose'
import { Plugin, PluginKey } from '@milkdown/prose/state'
import { $ctx, $prose } from '@milkdown/utils'
import { refractor } from 'refractor/core'
import { getPrismDecorations } from './prism-highlight'

export interface TelaPrismOptions {
  configureRefractor: (refractor: Refractor) => void | Refractor
}

/** Drop-in for @milkdown/plugin-prism with alias normalization + autodetect. */
export const telaPrismConfig = $ctx<TelaPrismOptions, 'telaPrismConfig'>(
  {
    configureRefractor: () => {},
  },
  'telaPrismConfig',
)

telaPrismConfig.meta = {
  package: '@tela/prism',
  displayName: 'Ctx<telaPrism>',
}

export const telaPrismPlugin = $prose((ctx) => {
  const { configureRefractor } = ctx.get(telaPrismConfig.key)
  const name = 'code_block'
  return new Plugin({
    key: new PluginKey('TELA_PRISM'),
    state: {
      init: (_, { doc }) => {
        const result = configureRefractor(refractor)
        return getPrismDecorations(doc, name, result ?? refractor)
      },
      apply: (transaction, decorationSet, oldState, state) => {
        const isNodeName = state.selection.$head.parent.type.name === name
        const isPreviousNodeName = oldState.selection.$head.parent.type.name === name
        const oldNode = findChildren((node) => node.type.name === name)(oldState.doc)
        const newNode = findChildren((node) => node.type.name === name)(state.doc)
        const codeBlockChanged =
          transaction.docChanged &&
          (isNodeName ||
            isPreviousNodeName ||
            oldNode.length !== newNode.length ||
            oldNode[0]?.node.attrs.language !== newNode[0]?.node.attrs.language ||
            transaction.steps.some((step) => {
              const s = step as unknown as { from: number; to: number }
              return (
                s.from !== undefined &&
                s.to !== undefined &&
                oldNode.some((node) => {
                  return node.pos >= s.from && node.pos + node.node.nodeSize <= s.to
                })
              )
            }))

        if (codeBlockChanged) return getPrismDecorations(transaction.doc, name, refractor)

        return decorationSet.map(transaction.mapping, transaction.doc)
      },
    },
    props: {
      decorations(this: Plugin, state) {
        return this.getState(state)
      },
    },
  })
})

telaPrismPlugin.meta = {
  package: '@tela/prism',
  displayName: 'Prose<telaPrism>',
}

export const telaPrism: MilkdownPlugin[] = [telaPrismPlugin, telaPrismConfig]
