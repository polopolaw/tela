import { $prose } from '@milkdown/kit/utils'
import type { EditorView } from '@milkdown/prose/view'
import { Plugin } from '@milkdown/kit/prose/state'
import { CODE_LANGUAGES, resolveCodeLang } from '../../lib/code-highlight'

// Code-block chrome: a header bar (language picker + copy button) wrapped around
// each fenced code block. Implemented as a `code_block` nodeView.
//
// Safe alongside tela-prism: that plugin highlights via an inline DecorationSet
// (NOT a nodeView), so its token spans still land on our contentDOM `<code>`.
// The header is `contenteditable=false` chrome that lives in the nodeView's
// `dom` but outside the content hole, so it never enters the document or the
// markdown round-trip.

const COPY_LABEL = 'Copy'
const COPIED_LABEL = 'Copied'

function displayLang(lang: string, code: string): string {
  return resolveCodeLang(code, lang) ?? (lang.trim() || 'text')
}

export const codeBlockNodeView = $prose(
  () =>
    new Plugin({
      props: {
        nodeViews: {
          code_block: (node, view: EditorView, getPos) => {
            let current = node
            const lang = (node.attrs.language as string) || ''

            const pre = document.createElement('pre')
            const code = document.createElement('code')
            if (lang) {
              pre.dataset.language = lang
              code.setAttribute('data-language', lang)
            }
            pre.appendChild(code)

            const header = document.createElement('div')
            header.className = 'tela-codeblock-header'
            header.setAttribute('contenteditable', 'false')

            const langSelect = document.createElement('select')
            langSelect.className = 'tela-codeblock-lang'
            langSelect.setAttribute('aria-label', 'Code language')
            for (const id of CODE_LANGUAGES) {
              const opt = document.createElement('option')
              opt.value = id === 'text' ? '' : id
              opt.textContent = id
              langSelect.appendChild(opt)
            }
            langSelect.value = lang
            langSelect.addEventListener('mousedown', (e) => e.stopPropagation())
            langSelect.addEventListener('change', (e) => {
              e.preventDefault()
              const pos = getPos()
              if (pos == null) return
              const nextLang = langSelect.value
              const live = view.state.doc.nodeAt(pos)
              if (!live) return
              const tr = view.state.tr.setNodeMarkup(pos, undefined, {
                ...live.attrs,
                language: nextLang,
              })
              view.dispatch(tr)
              view.focus()
            })

            const copyBtn = document.createElement('button')
            copyBtn.type = 'button'
            copyBtn.className = 'tela-codeblock-copy'
            copyBtn.setAttribute('aria-label', 'Copy code')
            copyBtn.textContent = COPY_LABEL
            let resetTimer = 0
            copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
            copyBtn.addEventListener('click', (e) => {
              e.preventDefault()
              const text = code.textContent ?? ''
              void navigator.clipboard?.writeText(text).catch(() => {})
              copyBtn.textContent = COPIED_LABEL
              copyBtn.dataset.copied = 'true'
              window.clearTimeout(resetTimer)
              resetTimer = window.setTimeout(() => {
                copyBtn.textContent = COPY_LABEL
                delete copyBtn.dataset.copied
              }, 1100)
            })

            header.appendChild(langSelect)
            header.appendChild(copyBtn)

            const dom = document.createElement('div')
            dom.className = 'tela-codeblock'
            if (lang) dom.dataset.language = lang
            dom.appendChild(header)
            dom.appendChild(pre)

            const syncLangChrome = (rawLang: string, codeText: string) => {
              const shown = displayLang(rawLang, codeText)
              langSelect.value = rawLang
              if (rawLang) {
                dom.dataset.language = rawLang
                pre.dataset.language = rawLang
                code.setAttribute('data-language', rawLang)
              } else {
                delete dom.dataset.language
                delete pre.dataset.language
                code.removeAttribute('data-language')
              }
              dom.dataset.resolvedLanguage = shown === 'text' ? '' : shown
            }
            syncLangChrome(lang, node.textContent)

            return {
              dom,
              contentDOM: code,
              update: (updated) => {
                if (updated.type !== current.type) return false
                current = updated
                const newLang = (updated.attrs.language as string) || ''
                syncLangChrome(newLang, updated.textContent)
                return true
              },
              ignoreMutation: (m) => {
                if (header.contains(m.target as Node)) return true
                return m.type === 'attributes' && m.target === dom
              },
              destroy: () => window.clearTimeout(resetTimer),
            }
          },
        },
      },
    }),
)
