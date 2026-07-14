import { describe, expect, it } from 'vitest'
import { pngBase64FromExport, xmlFromExport } from './export'

describe('drawio export helpers', () => {
  it('strips data URL prefix from png export', () => {
    expect(pngBase64FromExport('data:image/png;base64,abc123')).toBe('abc123')
    expect(pngBase64FromExport('abc123')).toBe('abc123')
  })

  it('prefers export xml over fallback', () => {
    const xml = xmlFromExport(
      {
        event: 'export',
        format: 'xmlpng',
        message: { action: 'export', format: 'xmlpng' },
        data: 'data:image/png;base64,x',
        xml: '<mxfile></mxfile>',
      },
      '',
    )
    expect(xml).toBe('<mxfile></mxfile>')
  })

  it('throws when diagram xml is missing', () => {
    expect(() =>
      xmlFromExport(
        {
          event: 'export',
          format: 'xmlpng',
          message: { action: 'export', format: 'xmlpng' },
          data: 'data:image/png;base64,x',
          xml: '',
        },
        '  ',
      ),
    ).toThrow(/empty/i)
  })
})
