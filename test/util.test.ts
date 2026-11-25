import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { localHm, localHms, localYmd, pad2 } from '../src/shared/date'
import { isLoopbackHost } from '../src/shared/net'
import { errText, safeFileName, shortId, uniquePath } from '../src/main/util'
import { recent, remember } from '../src/main/memo'

describe('日付の書式', () => {
    const d = new Date(2026, 0, 5, 7, 8, 9)
    it('ゼロ埋めして区切りを選べる', () => {
        expect(pad2(3)).toBe('03')
        expect(localYmd(d)).toBe('2026-01-05')
        expect(localYmd(d, '')).toBe('20260105')
        expect(localYmd(d, '/')).toBe('2026/01/05')
        expect(localHm(d)).toBe('07:08')
        expect(localHms(d)).toBe('070809')
    })
})

describe('main の小さな helper', () => {
    it('ファイル名に使えない文字・末尾の点・Windows の予約名を避ける', () => {
        expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______')
        expect(safeFileName('契約書. ')).toBe('契約書')
        expect(safeFileName('con')).toBe('con_')
        expect(safeFileName('LPT1.txt')).toBe('LPT1.txt_')
        expect(safeFileName('\u0001')).toBe('_')
        expect(safeFileName('', 'document')).toBe('document')
    })

    it('同じ名前があれば「 (2)」「 (3)」と番号を付ける', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-util-'))
        expect(uniquePath(dir, '契約書', 'pdf')).toBe(join(dir, '契約書.pdf'))
        fs.writeFileSync(join(dir, '契約書.pdf'), '')
        expect(uniquePath(dir, '契約書', 'pdf')).toBe(join(dir, '契約書 (2).pdf'))
        fs.writeFileSync(join(dir, '契約書 (2).pdf'), '')
        expect(uniquePath(dir, '契約書', 'pdf')).toBe(join(dir, '契約書 (3).pdf'))
        fs.mkdirSync(join(dir, '納品'))
        expect(uniquePath(dir, '納品')).toBe(join(dir, '納品 (2)'))
    })

    it('ID は英小文字と数字だけで指定の長さ', () => {
        const id = shortId()
        expect(id).toMatch(/^[a-z0-9]{12}$/)
        expect(shortId(20)).toHaveLength(20)
        expect(shortId()).not.toBe(id)
    })

    it('Error 以外が投げられても文字列にする', () => {
        expect(errText(new Error('x'))).toBe('x')
        expect(errText('y')).toBe('y')
        expect(errText(undefined)).toBe('undefined')
    })

    it('ループバックのホストだけを認める', () => {
        expect(['127.0.0.1', 'localhost', '[::1]'].every(isLoopbackHost)).toBe(true)
        expect(isLoopbackHost('127.0.0.2')).toBe(false)
        expect(isLoopbackHost('example.com')).toBe(false)
    })
})

describe('キャッシュの helper', () => {
    it('remember は上限に達したら空にしてから入れる', () => {
        const m = new Map<string, number>()
        remember(m, 'a', 1, 2)
        remember(m, 'b', 2, 2)
        expect(remember(m, 'c', 3, 2)).toBe(3)
        expect([...m.keys()]).toEqual(['c'])
    })

    it('recent は最近使ったものを残し、古いものから捨てる', () => {
        const m = new Map<string, { n: number }>()
        let made = 0
        const get = (k: string) => recent(m, k, () => ({ n: ++made }), 2)
        const a = get('a')
        get('b')
        expect(get('a')).toBe(a)
        get('c')
        expect([...m.keys()]).toEqual(['a', 'c'])
        expect(made).toBe(3)
    })
})
