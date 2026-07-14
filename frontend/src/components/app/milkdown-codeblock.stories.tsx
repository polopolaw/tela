import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { highlightCodeChildren } from '../../lib/code-highlight'

// Showcase the code-block chrome (language label + copy button). The editor
// renders the same class structure via the milkdown-codeblock.ts nodeView; here
// we render the static DOM inside a `.tela-milkdown .ProseMirror` wrapper so the
// scoped CSS applies without a Milkdown mount.

interface CodeBlockPreviewProps {
  language: string
  children: ReactNode
  resolvedLanguage?: string
}

function CodeBlockPreview({ language, children, resolvedLanguage }: CodeBlockPreviewProps) {
  const label = resolvedLanguage ?? (language || 'text')
  return (
    <div className="tela-milkdown">
      <div className="ProseMirror">
        <div className="tela-codeblock" data-language={language}>
          <div className="tela-codeblock-header" contentEditable={false}>
            <span className="tela-codeblock-lang">{label}</span>
            <button type="button" className="tela-codeblock-copy">
              Copy
            </button>
          </div>
          <pre data-language={language}>
            <code data-language={language}>{children}</code>
          </pre>
        </div>
      </div>
    </div>
  )
}

const meta: Meta<typeof CodeBlockPreview> = {
  title: 'App/Milkdown Code Block',
  component: CodeBlockPreview,
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof CodeBlockPreview>

const tsSample = `export function greet(name: string) {
  return \`Hello, \${name}\`
}`

export const TypeScript: Story = {
  render: () => {
    const { children } = highlightCodeChildren(tsSample, 'typescript')
    return (
      <CodeBlockPreview language="typescript">{children}</CodeBlockPreview>
    )
  },
}

export const NoLanguage: Story = {
  name: 'Autodetect (bash)',
  render: () => {
    const sample = '$ tela deploy --prod\n✓ built in 1.7s'
    const { lang, children } = highlightCodeChildren(sample, null)
    return (
      <CodeBlockPreview language="" resolvedLanguage={lang ?? 'text'}>
        {children}
      </CodeBlockPreview>
    )
  },
}

export const Copied: Story = {
  name: 'Copy button — copied state',
  render: () => (
    <div className="tela-milkdown">
      <div className="ProseMirror">
        <div className="tela-codeblock" data-language="bash">
          <div className="tela-codeblock-header" contentEditable={false}>
            <span className="tela-codeblock-lang">bash</span>
            <button type="button" className="tela-codeblock-copy" data-copied>
              Copied
            </button>
          </div>
          <pre data-language="bash">
            <code data-language="bash">npm run build</code>
          </pre>
        </div>
      </div>
    </div>
  ),
}
