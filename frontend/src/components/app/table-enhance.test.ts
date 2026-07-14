/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  applyGlyphToTable,
  enhanceAllTables,
  enhanceReadonlyTable,
  glyphFor,
} from './milkdown-table'

function makeTable(rowCount: number, opts?: { calendar?: boolean }): HTMLTableElement {
  const table = document.createElement('table')
  if (opts?.calendar) table.classList.add('tela-calendar-table')
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  const th = document.createElement('th')
  th.textContent = 'Col'
  headRow.appendChild(th)
  thead.appendChild(headRow)
  table.appendChild(thead)
  const tbody = document.createElement('tbody')
  for (let i = 0; i < rowCount; i++) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.textContent = `row ${i}`
    tr.appendChild(td)
    tbody.appendChild(tr)
  }
  table.appendChild(tbody)
  return table
}

describe('glyphFor', () => {
  it('maps comparison keywords', () => {
    expect(glyphFor('check')).toBe('check')
    expect(glyphFor('CROSS')).toBe('cross')
    expect(glyphFor('n/a')).toBe('dash')
    expect(glyphFor('maybe')).toBeNull()
  })
})

describe('applyGlyphToTable', () => {
  it('adds glyph classes for keyword cells', () => {
    const table = makeTable(1)
    table.rows[1].cells[0].textContent = 'check'
    applyGlyphToTable(table)
    expect(table.rows[1].cells[0].classList.contains('tela-cell-glyph-check')).toBe(true)
  })
})

describe('enhanceReadonlyTable', () => {
  it('adds sort/filter chrome on large tables', () => {
    const wrap = document.createElement('div')
    wrap.className = 'tableWrapper'
    const table = makeTable(8)
    wrap.appendChild(table)
    document.body.append(wrap)

    enhanceReadonlyTable(table)
    expect(table.querySelector('.tela-th-sortable')).not.toBeNull()
    expect(document.querySelector('.tela-table-filter')).not.toBeNull()

    wrap.remove()
  })

  it('skips small tables', () => {
    const table = makeTable(5)
    document.body.append(table)
    enhanceReadonlyTable(table)
    expect(table.dataset.telaEnhanced).toBeUndefined()
    expect(table.querySelector('.tela-th-sortable')).toBeNull()
    table.remove()
  })
})

describe('enhanceAllTables', () => {
  it('skips calendar tables', () => {
    const root = document.createElement('div')
    const table = makeTable(8, { calendar: true })
    root.append(table)
    document.body.append(root)

    enhanceAllTables(root)
    expect(table.dataset.telaEnhanced).toBeUndefined()

    root.remove()
  })
})
