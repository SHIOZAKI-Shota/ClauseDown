import { describe, expect, it } from 'vitest'
import { createSoftwareAuthenticator, generateEd25519, MemoryTofuStore, parseDocument, signDocument, toBase64, verifyDocument } from '@mdsig/core'
import { overallStatus, requireLines, sameBody, X_CLAUSEDOWN, type MdVerifyReport } from '../src/shared/mdsig'
import { layout, locks, scanBody } from '../src/shared/mdsig-layout'
import { parseLegal } from '../src/shared/legal-parser'
import { renderDoc } from '../src/shared/legal-renderer'

const SOURCE =
    '# 業務委託契約書\n<!-- clausedown\nparagraph: { numeral: arabic, hang: text }\n-->\n\n### 目的\n- 甲は乙に業務を委託する。\n\n## 署名欄 {.closing}\n\n甲　見本株式会社\n'
const OID = 'a'.repeat(40)

async function report(text: string): Promise<MdVerifyReport> {
    const result = await verifyDocument(text, { offline: true, tofuStore: new MemoryTofuStore(), checkRevocation: false })
    const l = layout(text)
    return { result, findings: scanBody(text), layout: l, locks: locks(l) }
}

async function request(require: Parameters<typeof requireLines>[0], sequential = false) {
    const us = await generateEd25519()
    const signed = await signDocument(SOURCE, {
        signer: us.signer,
        method: 'tofu',
        signerId: '見本株式会社',
        role: 'author',
        require: requireLines(require, sequential),
        extra: { [X_CLAUSEDOWN]: OID },
    })
    return { us, text: signed.text }
}

async function cosign(text: string, signerId: string) {
    const passkey = await createSoftwareAuthenticator('sign.clausedown.app')
    return (await signDocument(text, { signer: passkey, method: 'tofu', signerId, role: 'approver' })).text
}

describe('ClauseDown 署名依頼（.cdsign）', () => {
    it('こちらの署名だけでは pending、相手の連署で complete になる', async () => {
        const { text } = await request([{ method: 'tofu', signer: 'bob@partner.example', role: 'approver' }])
        const first = await report(text)
        expect(first.result.ok).toBe(true)
        expect(first.result.agreement.status).toBe('pending')
        expect(overallStatus(first)).toBe('pending')
        expect(first.result.signatures[0].fields[X_CLAUSEDOWN]).toBe(OID)

        const done = await report(await cosign(text, 'bob@partner.example'))
        expect(done.result.ok).toBe(true)
        expect(done.result.agreement.status).toBe('complete')
        expect(overallStatus(done)).toBe('verified')
        expect(done.result.signatures[1].fields.rp_id).toBe('sign.clausedown.app')
        expect(done.locks.kind).toBe('full')
    })

    it('本文は版のソースと一致し、表示には署名ブロックが出ない', async () => {
        const { text } = await request([{ method: 'tofu', signer: 'bob@partner.example' }])
        const signed = await cosign(text, 'bob@partner.example')
        expect(sameBody(parseDocument(signed).body, SOURCE)).toBe(true)
        expect(sameBody(parseDocument(signed).body, SOURCE.replace(/\n/g, '\r\n'))).toBe(true)
        const doc = parseLegal(signed)
        expect(doc.signatures?.count).toBe(2)
        expect(renderDoc(doc)).not.toContain('md-signature')
    })

    it('本文を変えると無効になり、版のソースとも一致しない', async () => {
        const { text } = await request([{ method: 'tofu', signer: 'bob@partner.example' }])
        const tampered = (await cosign(text, 'bob@partner.example')).replace('委託する', '委託しない')
        const r = await report(tampered)
        expect(r.result.ok).toBe(false)
        expect(r.result.signatures[0].code).toBe('hash-mismatch')
        expect(overallStatus(r)).toBe('failed')
        expect(sameBody(parseDocument(tampered).body, SOURCE)).toBe(false)
    })

    it('別の人の連署では complete にならない', async () => {
        const { text } = await request([{ method: 'tofu', signer: 'bob@partner.example' }])
        const r = await report(await cosign(text, 'mallory@example.com'))
        expect(r.result.agreement.status).toBe('pending')
    })

    it('step を付けると順番に連署してもらう', async () => {
        const { text } = await request(
            [
                { method: 'tofu', signer: 'bob@partner.example' },
                { method: 'tofu', signer: 'carol@partner.example' },
            ],
            true,
        )
        expect(parseDocument(text).chain[0].fields.require).toBe('step 1\ntofu:bob@partner.example\nstep 2\ntofu:carol@partner.example')
        const early = await report(await cosign(text, 'carol@partner.example'))
        expect(early.result.agreement.status).toBe('pending')
        const both = await report(await cosign(await cosign(text, 'bob@partner.example'), 'carol@partner.example'))
        expect(both.result.agreement.status).toBe('complete')
    })

    it('最後の署名ブロックの後ろに内容がある文書には連署しない', async () => {
        const { text } = await request([{ method: 'tofu', signer: 'bob@partner.example' }])
        const appended = text + '\n追記した条項\n'
        expect(parseDocument(appended).strayMarker).toBe(true)
        await expect(cosign(appended, 'bob@partner.example')).rejects.toThrow()
        const r = await report(appended)
        expect(r.result.ok).toBe(false)
    })

    it('書式設定のコメントも「表示されない内容」として一覧に出す', async () => {
        const { text } = await request([])
        expect((await report(text)).findings.map((f) => f.kind)).toEqual(['config'])
    })

    it('埋め込んだ鍵がこちらの鍵と一致する', async () => {
        const { us, text } = await request([])
        expect(parseDocument(text).chain[0].fields.pubkey).toBe(`ed25519:${toBase64(us.signer.publicKey)}`)
    })
})

describe('編集の制限', () => {
    const block = (scope?: string) =>
        `<!-- md-signature\nv: 0.0.4\nmethod: tofu\nsigner: a\nts: 2026-11-16T09:00:00Z\n${scope ? `scope: ${scope}\n` : ''}hash: sha256:00\nsig: base64:AA\n-->\n`

    it('全文署名は full、セクション署名は署名済みのセクションだけ', () => {
        expect(locks(layout(SOURCE)).kind).toBe('free')
        expect(locks(layout(SOURCE + '\n' + block())).kind).toBe('full')
        const scoped = '# 文書\n\n<!-- mdsig:section terms -->\n### 条件\n- 一年とする。\n<!-- /mdsig:section -->\n\nメモ欄\n\n' + block('section:terms')
        const lk = locks(layout(scoped))
        expect(lk.kind).toBe('scoped')
        expect(lk.lines).toEqual([{ from: 3, to: 6 }])
        expect(lk.toEnd).toBe(10)
    })
})

describe('編集の制限（エディター）', () => {
    const block = `<!-- md-signature\nv: 0.0.4\nmethod: tofu\nsigner: a\nts: 2026-11-16T09:00:00Z\nscope: section:terms\nhash: sha256:00\nsig: base64:AA\n-->\n`
    const scoped = '# 文書\n\n<!-- mdsig:section terms -->\n### 条件\n- 一年とする。\n<!-- /mdsig:section -->\n\nメモ欄\n\n' + block

    it('署名済みの範囲への変更を拒み、それ以外は通す', async () => {
        const { EditorState } = await import('@codemirror/state')
        const { signatureLock } = await import('../src/renderer/utils/signature-lock')
        let blocked = 0
        const state = EditorState.create({
            doc: scoped,
            extensions: signatureLock(
                () => blocked++,
                (n) => String(n),
            ),
        })
        const at = (s: string) => scoped.indexOf(s)
        const inside = state.update({ changes: { from: at('一年'), insert: '二' } })
        expect(inside.state.doc.toString()).toBe(scoped)
        const outside = state.update({ changes: { from: at('メモ欄') + 3, insert: '：済' } })
        expect(outside.state.doc.toString()).toContain('メモ欄：済')
        const tail = state.update({ changes: { from: scoped.length, insert: '追記' } })
        expect(tail.state.doc.toString()).toBe(scoped)
        const forced = state.update({ changes: { from: 0, to: scoped.length, insert: 'x' }, filter: false })
        expect(forced.state.doc.toString()).toBe('x')
        await Promise.resolve()
        expect(blocked).toBe(2)
    })
})
