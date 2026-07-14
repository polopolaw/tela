import { describe, expect, it } from 'vitest'
import {
  guessCodeLang,
  normalizeCodeLang,
  resolveCodeLang,
} from './code-highlight'

describe('normalizeCodeLang', () => {
  it('maps common aliases', () => {
    expect(normalizeCodeLang('ts')).toBe('typescript')
    expect(normalizeCodeLang('py')).toBe('python')
    expect(normalizeCodeLang('html')).toBe('markup')
  })

  it('treats empty as plain text', () => {
    expect(normalizeCodeLang('')).toBeNull()
    expect(normalizeCodeLang('text')).toBeNull()
  })
})

describe('guessCodeLang', () => {
  it('detects shell one-liners', () => {
    expect(guessCodeLang('npm run build')).toBe('bash')
  })

  it('detects typescript imports', () => {
    expect(guessCodeLang("import { x } from 'y'")).toBe('typescript')
  })

  it('detects json objects', () => {
    expect(guessCodeLang('{"ok": true}')).toBe('json')
  })
})

describe('resolveCodeLang', () => {
  it('prefers explicit fence label over guess', () => {
    expect(resolveCodeLang('npm run build', 'python')).toBe('python')
  })

  it('falls back to guess when fence is empty', () => {
    expect(resolveCodeLang('package main', null)).toBe('go')
  })
})
