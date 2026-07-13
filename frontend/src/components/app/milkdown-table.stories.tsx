import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef } from 'react'
import { enhanceReadonlyTable } from '../../lib/blocks/table'

type Cell = { glyph?: 'check' | 'cross' | 'dash'; text?: string; bold?: boolean }

function RequirementsTable() {
  const ref = useRef<HTMLTableElement>(null)
  useEffect(() => {
    if (ref.current) enhanceReadonlyTable(ref.current)
  }, [])
  const head = ['Клиент', 'Требование', 'Статус']
  const rows: Cell[][] = [
    [
      { text: 'Пиво Инкорпорейтед' },
      { text: 'SSO через SAML' },
      { glyph: 'cross' },
    ],
    [
      { text: 'Пиво Инкорпорейтед' },
      { text: 'Экспорт в PDF' },
      { glyph: 'check' },
    ],
    [
      { text: 'Кофе Лтд' },
      { text: 'Двухфакторная аутентификация' },
      { glyph: 'dash' },
    ],
    [
      { text: 'Кофе Лтд' },
      { text: 'API доступ' },
      { glyph: 'check' },
    ],
    [
      { text: 'Чай Холдинг' },
      { text: 'Кастомный домен' },
      { glyph: 'cross' },
    ],
    [
      { text: 'Чай Холдинг' },
      { text: 'Аудит-лог' },
      { glyph: 'check' },
    ],
    [
      { text: 'Сок ООО' },
      { text: 'Webhooks' },
      { glyph: 'dash' },
    ],
    [
      { text: 'Сок ООО' },
      { text: 'Роли и права' },
      { glyph: 'check' },
    ],
  ]
  return (
    <div className="tela-milkdown">
      <div className="ProseMirror" style={{ maxWidth: '48rem' }}>
        <div className="tableWrapper">
          <table ref={ref}>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>
                    <p>{h}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="tela-table-subheader-row">
                {['Пиво Инкорпорейтед', '', ''].map((t, i) => (
                  <td key={i}>
                    <p>
                      <strong>{t}</strong>
                    </p>
                  </td>
                ))}
              </tr>
              {rows.slice(0, 2).map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={
                        cell.glyph
                          ? `tela-cell-glyph tela-cell-glyph-${cell.glyph}`
                          : undefined
                      }
                    >
                      <p>{cell.glyph ?? cell.text}</p>
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="tela-table-subheader-row">
                {['Кофе Лтд', '', ''].map((t, i) => (
                  <td key={i}>
                    <p>
                      <strong>{t}</strong>
                    </p>
                  </td>
                ))}
              </tr>
              {rows.slice(2, 4).map((row, r) => (
                <tr key={r + 2}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={
                        cell.glyph
                          ? `tela-cell-glyph tela-cell-glyph-${cell.glyph}`
                          : undefined
                      }
                    >
                      <p>{cell.glyph ?? cell.text}</p>
                    </td>
                  ))}
                </tr>
              ))}
              {rows.slice(4).map((row, r) => (
                <tr key={r + 4}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={
                        cell.glyph
                          ? `tela-cell-glyph tela-cell-glyph-${cell.glyph}`
                          : undefined
                      }
                    >
                      <p>{cell.glyph ?? cell.text}</p>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

const meta: Meta<typeof RequirementsTable> = {
  title: 'App/Milkdown Table',
  component: RequirementsTable,
  parameters: { layout: 'padded' },
}
export default meta

type Story = StoryObj<typeof RequirementsTable>

export const RequirementsGathering: Story = {
  name: 'Requirements matrix (per-column filter + subheaders)',
}
