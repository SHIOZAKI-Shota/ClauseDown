import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { fromHouritsu, fromKanji, isHouritsu, toHouritsu } from '../src/shared/houritsu'
import { parseLegal } from '../src/shared/legal-parser'

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '' }),
}))

const FM = `---
law_id: "999AC0000000001"
law_num: "令和九年法律第一号"
title: "見本法"
---
`

const SAMPLE = `${FM}
# 見本法

## 第一編　総則

### 第一章　通則

#### 第一条（目的）

この法律は、見本を定める。

#### 第二条（定義）

この法律において、次の各号に掲げる用語の意義は、当該各号に定めるところによる。

- 一 見本 次のいずれかに該当するものをいう。

  - イ 紙の見本

  - ロ 電子の見本

- 一の二 写し 見本を写したものをいう。

- 二 原本 見本の元をいう。

２ 前項の規定は、別段の定めがある場合には、適用しない。

### 第二章　手続

#### 第一節　届出

##### 第二条の二（届出）

見本を作る者は、届け出なければならない。

##### 第三条から第五条まで

削除

##### 第六条（報告）

届出をした者は、毎年報告しなければならない。

##### 第七条及び第八条

削除

##### 第九条（雑則）

この章に定めるもののほか、必要な事項は、政令で定める。

## 附　則

この法律は、公布の日から施行する。

## 附　則（令和十年法律第二号）

### 第十条（経過措置）

この法律の施行前にした行為については、なお従前の例による。

### 第十一条

（罰則に関する経過措置）

この法律の施行前にした行為に対する罰則の適用については、なお従前の例による。

<table>
<tr><th>区分</th><th>額</th></tr>
<tr><td rowspan="2">甲</td><td>百円</td></tr>
<tr><td>二百円</td></tr>
</table>
`

const labels = (text: string) => parseLegal(text).chapters.map((c) => c.articles.map((a) => a.label))

describe('houritsu 形式', () => {
    it('漢数字を数にする', () => {
        expect([fromKanji('一'), fromKanji('十'), fromKanji('十九'), fromKanji('百五十五'), fromKanji('千二十')]).toEqual([1, 10, 19, 155, 1020])
    })

    it('先頭の YAML に law_id と law_num があれば houritsu 形式と見る', () => {
        expect(isHouritsu(SAMPLE)).toBe(true)
        expect(isHouritsu('# 規程\n\n### 目的\n- 本文\n')).toBe(false)
        expect(isHouritsu('---\ntitle: x\n---\n# x\n')).toBe(false)
    })

    it('取り込むと、条・項・号の番号が元と同じになり、編・節は消える', () => {
        const r = fromHouritsu(SAMPLE)
        expect(r.warnings.filter((w) => w.includes('番号'))).toEqual([])
        expect(r.text).toContain('law_id: "999AC0000000001"')
        expect(r.text).not.toContain('第一編')
        expect(r.text).not.toContain('第一節')
        expect(labels(r.text)).toEqual([
            ['第一条', '第二条'],
            ['第二条の二', '第三条', '第四条', '第五条', '第六条', '第七条', '第八条', '第九条'],
            [],
            ['第十条', '第十一条'],
        ])
        const doc = parseLegal(r.text)
        const art2 = doc.chapters[0].articles[1]
        expect(art2.paragraphs.map((p) => p.label)).toEqual(['', '２'])
        expect(art2.paragraphs[0].items.map((i) => i.label)).toEqual(['一', '一の二', '二'])
        expect(art2.paragraphs[0].items[0].children.map((i) => i.label)).toEqual(['イ', 'ロ'])
        expect(doc.chapters[1].articles.filter((a) => a.deleted)).toHaveLength(5)
        expect(doc.chapters[0].title).toBe('第一章　通則')
    })

    it('表は Markdown の表にし、結合したセルは拡張テーブル記法で残す', () => {
        const r = fromHouritsu(SAMPLE)
        expect(r.text).toContain('| 甲 | 百円 |')
        expect(r.text).toContain('| ^ | 二百円 |')
        expect(r.warnings.some((w) => w.includes('結合したセル'))).toBe(false)
    })

    it('書き出すと、編・節の見出しを除いて元の形に戻る', () => {
        const back = toHouritsu(fromHouritsu(SAMPLE).text)
        const keep = (s: string) =>
            s
                .split('\n')
                .filter((l) => !/^#+ 第[一二三四五六七八九十]+[編節]/.test(l) && !/^<|^\|/.test(l))
                .map((l) => l.replace(/^#+ /, ''))
                .filter((l) => l.trim())
        expect(keep(back)).toEqual(keep(SAMPLE))
    })

    it('ClauseDown の文書を書き出すと、YAML に題名だけを書き、番号を本文に書く', () => {
        const out = toHouritsu('# 就業規則\n\n## 総則\n\n### 目的\n- この規則は、働き方を定める。\n- 前項の定めは、全員に適用する。\n  - 社員\n  - 役員\n')
        expect(out).toBe(
            [
                '---',
                'title: "就業規則"',
                '---',
                '',
                '# 就業規則',
                '',
                '## 第一章　総則',
                '',
                '### 第一条（目的）',
                '',
                'この規則は、働き方を定める。',
                '',
                '２ 前項の定めは、全員に適用する。',
                '',
                '- 一 社員',
                '',
                '- 二 役員',
                '',
            ].join('\n'),
        )
    })

    it('取り込んだ文書は、版を保存しても形が変わらない（改行の種類を保つ）', () => {
        const crlf = SAMPLE.replace(/\n/g, '\r\n')
        expect(fromHouritsu(crlf).text).toContain('\r\n')
    })
})

describe('houritsu 形式のリポジトリを変換する', () => {
    it('houritsu 形式の文書だけを変換し、1 つの版にする', async () => {
        const git = await import('../src/main/git')
        const h = await import('../src/main/houritsu')
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-houritsu-'))
        await git.initRepo(dir)
        fs.mkdirSync(join(dir, 'laws'))
        fs.writeFileSync(join(dir, 'laws', 'mihon.md'), SAMPLE, 'utf8')
        fs.writeFileSync(join(dir, 'README.md'), '# 説明\n', 'utf8')
        await git.saveVersion(dir, { message: '初版' })

        expect(await h.detectHouritsu(dir)).toEqual(['laws/mihon.md'])
        const r = await h.convertHouritsu(dir, ['laws/mihon.md'])
        expect(r.converted).toBe(1)
        expect(r.skipped).toEqual([])

        const [last] = await git.log(dir)
        expect(last.message).toContain('houritsu の形式から ClauseDown の形に変換（1 件）')
        expect((await git.listDocs(dir)).every((d) => !d.changed)).toBe(true)
        expect(fs.readFileSync(join(dir, 'laws', 'mihon.md'), 'utf8')).toContain('<!-- clausedown')
        expect(await h.detectHouritsu(dir)).toEqual([])
    })

    it('保存していない変更がある文書は変換しない', async () => {
        const git = await import('../src/main/git')
        const h = await import('../src/main/houritsu')
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-houritsu-'))
        await git.initRepo(dir)
        fs.writeFileSync(join(dir, 'a.md'), SAMPLE, 'utf8')
        await git.saveVersion(dir, { message: '初版' })
        fs.writeFileSync(join(dir, 'a.md'), SAMPLE + '\n追記\n', 'utf8')
        const r = await h.convertHouritsu(dir, ['a.md'])
        expect(r).toMatchObject({ converted: 0, skipped: ['a.md'] })
    })
})

describe('変換の途中で失敗したとき', () => {
    it('書き換えたファイルを前の版の中身に戻す', async () => {
        const git = await import('../src/main/git')
        const h = await import('../src/main/houritsu')
        const igit = (await import('../src/main/igit')).default
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-houritsu-'))
        await git.initRepo(dir)
        fs.writeFileSync(join(dir, 'a.md'), SAMPLE, 'utf8')
        fs.writeFileSync(join(dir, 'b.md'), SAMPLE, 'utf8')
        await git.saveVersion(dir, { message: '初版' })
        const spy = vi.spyOn(igit, 'commit').mockRejectedValueOnce(new Error('書き込めません'))
        await expect(h.convertHouritsu(dir, ['a.md', 'b.md'])).rejects.toThrow('書き込めません')
        spy.mockRestore()
        expect(fs.readFileSync(join(dir, 'a.md'), 'utf8')).toBe(SAMPLE)
        expect(fs.readFileSync(join(dir, 'b.md'), 'utf8')).toBe(SAMPLE)
        expect((await git.listDocs(dir)).every((d) => !d.changed)).toBe(true)
    })
})

describe('崩れやすい行', () => {
    const wrap = (body: string) => `${FM}\n# 見本法\n\n#### 第一条（目的）\n\n${body}\n`
    it('図の行は項にせず、前の項に付ける', () => {
        const r = fromHouritsu(wrap('次の図のとおりとする。\n\n（図：e-Gov に画像なし）\n\n[様式第一](https://laws.e-gov.go.jp/x.pdf)\n\n２ 前項の図は、例とする。'))
        const ps = parseLegal(r.text).chapters[0].articles[0].paragraphs
        expect(ps.map((p) => p.label)).toEqual(['', '２'])
        expect(ps[0].text).toContain('（図：e-Gov に画像なし）')
        expect(r.warnings).toEqual([])
    })

    it('番号の無い箇条書きは、本文として残す', () => {
        const r = fromHouritsu(wrap('次のとおりとする。\n\n- 削除\n\n- 一 甲'))
        const items = parseLegal(r.text).chapters[0].articles[0].paragraphs[0].items
        expect(items.map((i) => [i.label, i.text])).toEqual([
            ['一', '削除'],
            ['一', '甲'],
        ])
    })

    it('項の見出しは次の項に付け、項の数を増やさない', () => {
        const r = fromHouritsu(`${FM}\n# 見本法\n\n## 附　則\n\n（施行期日）\n\n１ この法律は、公布の日から施行する。\n\n（経過措置）\n\n２ 従前の例による。\n`)
        const intro = parseLegal(r.text).chapters[0].intro
        expect(intro.map((p) => p.label)).toEqual(['１', '２'])
        expect(intro[1].text).toBe('（経過措置）\n従前の例による。')
    })
})
