// Shared GFM table helpers — used by Milkdown plugins and MarkdownView so
// glyph cells, subheader rows, and read-mode enhancements stay in sync.

const GLYPHS: Record<string, 'check' | 'cross' | 'dash'> = {
  check: 'check',
  '✓': 'check',
  '✔': 'check',
  yes: 'check',
  cross: 'cross',
  '✗': 'cross',
  '✕': 'cross',
  '×': 'cross',
  no: 'cross',
  dash: 'dash',
  '–': 'dash',
  '—': 'dash',
  '-': 'dash',
  'n/a': 'dash',
}

export function glyphFor(text: string): 'check' | 'cross' | 'dash' | null {
  const t = text.trim()
  if (!t) return null
  return GLYPHS[t.toLowerCase()] ?? null
}

export function tableCellGlyphClass(text: string): string | undefined {
  const g = glyphFor(text)
  return g ? `tela-cell-glyph tela-cell-glyph-${g}` : undefined
}

/** Plain text extracted from a mdast table cell (paragraphs only). */
export function mdastCellPlainText(node: {
  children?: { type?: string; value?: unknown; children?: unknown[] }[]
}): string {
  const parts: string[] = []
  for (const child of node.children ?? []) {
    if (child.type === 'text') parts.push(String(child.value ?? ''))
    else if (child.type === 'paragraph') {
      parts.push(mdastCellPlainText(child as typeof node))
    } else if (child.type === 'strong') {
      parts.push(mdastCellPlainText(child as typeof node))
    }
  }
  return parts.join('').trim()
}

/** Row is a subheader when every cell is a single bold paragraph (or empty). */
export function isSubheaderRow(
  cells: { children?: { type?: string; children?: unknown[] }[] }[],
): boolean {
  if (cells.length === 0) return false
  let anyBold = false
  const ok = cells.every((cell) => {
    const kids = cell.children ?? []
    if (kids.length === 0) return true
    if (kids.length !== 1 || kids[0].type !== 'paragraph') return false
    const inline = (kids[0].children ?? []) as { type?: string }[]
    if (inline.length === 0) return true
    const allStrong = inline.every((n) => n.type === 'strong')
    if (allStrong) anyBold = true
    return allStrong
  })
  return ok && anyBold
}

export function enhanceReadonlyTablesInRoot(root: HTMLElement): void {
  root
    .querySelectorAll('table:not(.tela-calendar-table)')
    .forEach((t) => enhanceReadonlyTable(t as HTMLTableElement))
}

// Numeric-aware comparison for sort headers.
export function compareTableCells(a: string, b: string): number {
  const na = parseFloat(a.replace(/[^0-9.+-]/g, ''))
  const nb = parseFloat(b.replace(/[^0-9.+-]/g, ''))
  const aNum = a.trim() !== '' && !Number.isNaN(na) && /\d/.test(a)
  const bNum = b.trim() !== '' && !Number.isNaN(nb) && /\d/.test(b)
  if (aNum && bNum) return na - nb
  return a.trim().localeCompare(b.trim(), undefined, { numeric: true })
}

function cellText(row: HTMLTableRowElement, i: number): string {
  return row.cells[i]?.textContent?.trim() ?? ''
}

/** Per-column filter row + sortable headers. Idempotent DOM enhancement. */
export function enhanceReadonlyTable(table: HTMLTableElement): void {
  if (table.dataset.telaEnhanced) return
  const thead = table.tHead
  const tbody = table.tBodies[0]
  const headRow = thead?.rows[0]
  if (!headRow || !tbody) return
  const headCells = Array.from(headRow.cells)
  if (headCells.length === 0) return
  table.dataset.telaEnhanced = '1'

  headCells.forEach((th, i) => {
    th.classList.add('tela-th-sortable')
    let dir = 0
    th.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.tela-table-filter-cell')) return
      dir = dir === 1 ? -1 : 1
      headCells.forEach((h) => h.removeAttribute('data-sort'))
      th.dataset.sort = dir === 1 ? 'asc' : 'desc'
      const rows = Array.from(tbody.rows).filter(
        (r) => !r.classList.contains('tela-table-subheader-row'),
      )
      rows.sort(
        (ra, rb) => compareTableCells(cellText(ra, i), cellText(rb, i)) * dir,
      )
      for (const row of rows) tbody.appendChild(row)
    })
  })

  const filterRow = document.createElement('tr')
  filterRow.className = 'tela-table-filter-row'
  const filters: HTMLInputElement[] = []
  headCells.forEach((th, i) => {
    const cell = document.createElement('th')
    cell.className = 'tela-table-filter-cell'
    const input = document.createElement('input')
    input.type = 'text'
    const label = th.textContent?.trim() || `Column ${i + 1}`
    input.placeholder = '…'
    input.setAttribute('aria-label', `Filter column ${label}`)
    input.addEventListener('click', (e) => e.stopPropagation())
    filters.push(input)
    cell.appendChild(input)
    filterRow.appendChild(cell)
  })
  thead!.appendChild(filterRow)

  const applyFilters = () => {
    for (const row of Array.from(tbody.rows)) {
      if (row.classList.contains('tela-table-subheader-row')) {
        row.style.display = ''
        continue
      }
      const visible = filters.every((input, i) => {
        const q = input.value.trim().toLowerCase()
        if (!q) return true
        return cellText(row, i).toLowerCase().includes(q)
      })
      row.style.display = visible ? '' : 'none'
    }
  }
  filters.forEach((input) => input.addEventListener('input', applyFilters))
}
