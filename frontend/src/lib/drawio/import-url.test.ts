import { describe, expect, it } from 'vitest'
import { decodeDiagramsNetHash } from './decode-hash'
import { computeDrawioSceneHash, isDrawioXml } from './hash'

describe('decodeDiagramsNetHash', () => {
  it('returns unsupported for empty hash', () => {
    expect(decodeDiagramsNetHash('')).toEqual({ kind: 'unsupported' })
  })

  it('decodes U-prefixed remote URL', () => {
    const url = 'https://example.com/diagram.xml'
    const encoded = encodeURIComponent(url)
    expect(decodeDiagramsNetHash(`#U${encoded}`)).toEqual({ kind: 'url', url })
  })
})

describe('isDrawioXml', () => {
  it('detects mxfile', () => {
    expect(isDrawioXml('<mxfile host="app.diagrams.net"></mxfile>')).toBe(true)
  })
})

describe('computeDrawioSceneHash', () => {
  it('returns 32 hex chars', async () => {
    const hash = await computeDrawioSceneHash('<mxfile></mxfile>')
    expect(hash).toMatch(/^[a-f0-9]{32}$/)
  })
})
