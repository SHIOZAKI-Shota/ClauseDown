import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { describe, expect, it } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { assertValid, certSummary, createSelfSigned, keySigner, p12Signer, signPdf, TsaError } from '../src/main/pdf-sign'

setLocale('ja')

const PRINTED = new Uint8Array(fs.readFileSync(join(__dirname, 'fixtures/chromium-print.pdf')))
const has = (cmd: string) => {
    try {
        execFileSync(cmd, ['version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

function lastSignature(pdf: Uint8Array) {
    const text = Buffer.from(pdf).toString('latin1')
    const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].at(-1)!
    const [a, b, c, d] = ranges.slice(1).map(Number)
    const signed = Buffer.concat([Buffer.from(pdf.subarray(a, a + b)), Buffer.from(pdf.subarray(c, c + d))])
    const hexContents = text
        .slice(a + b, c)
        .replace(/[<>\s]/g, '')
        .replace(/(00)+$/, '')
    const cms = Buffer.from(hexContents, 'hex')
    const dict = text.slice(Math.max(0, a + b - 4000), a + b)
    return { signed, cms, dict }
}

async function verifyCms(cms: Buffer, data: Buffer) {
    const info = new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result })
    const sd = new pkijs.SignedData({ schema: info.content })
    const ok = await sd.verify({ signer: 0, data: new Uint8Array(data).buffer, checkChain: false }).catch(() => false)
    const attrs = sd.signerInfos[0].signedAttrs!.attributes.map((x) => x.type)
    const unsigned = sd.signerInfos[0].unsignedAttrs?.attributes.map((x) => x.type) ?? []
    return { ok, attrs, unsigned, sd }
}

async function fakeTsa(seen: Record<string, string>[]): Promise<typeof globalThis.fetch> {
    const { key, cert } = await createSelfSigned({ name: 'Test TSA' })
    const privateKey = await globalThis.crypto.subtle.importKey('pkcs8', new Uint8Array(key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const tsaCert = new pkijs.Certificate({ schema: asn1js.fromBER(cert).result })
    return (async (_url: string, init?: RequestInit) => {
        seen.push(Object.fromEntries(new Headers(init?.headers).entries()))
        const body = new Uint8Array(await new Response(init!.body).arrayBuffer())
        const req = new pkijs.TimeStampReq({ schema: asn1js.fromBER(body).result })
        const tst = new pkijs.TSTInfo({
            version: 1,
            policy: '1.2.3.4.1',
            messageImprint: req.messageImprint,
            serialNumber: new asn1js.Integer({ value: 1 }),
            genTime: new Date(),
            nonce: req.nonce,
        })
        const content = new Uint8Array(tst.toSchema().toBER(false))
        const digest = await globalThis.crypto.subtle.digest('SHA-256', content)
        const sd = new pkijs.SignedData({
            version: 3,
            encapContentInfo: new pkijs.EncapsulatedContentInfo({
                eContentType: '1.2.840.113549.1.9.16.1.4',
                eContent: new asn1js.OctetString({ valueHex: content.buffer }),
            }),
            signerInfos: [
                new pkijs.SignerInfo({
                    version: 1,
                    sid: new pkijs.IssuerAndSerialNumber({ issuer: tsaCert.issuer, serialNumber: tsaCert.serialNumber }),
                    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
                        type: 0,
                        attributes: [
                            new pkijs.Attribute({
                                type: '1.2.840.113549.1.9.3',
                                values: [new asn1js.ObjectIdentifier({ value: '1.2.840.113549.1.9.16.1.4' })],
                            }),
                            new pkijs.Attribute({ type: '1.2.840.113549.1.9.4', values: [new asn1js.OctetString({ valueHex: digest })] }),
                        ],
                    }),
                }),
            ],
            certificates: [tsaCert],
        })
        await sd.sign(privateKey, 0, 'SHA-256')
        const token = new pkijs.ContentInfo({ contentType: '1.2.840.113549.1.7.2', content: sd.toSchema(true) })
        const resp = new pkijs.TimeStampResp({ status: new pkijs.PKIStatusInfo({ status: 0 }), timeStampToken: token })
        return new Response(resp.toSchema().toBER(false), { headers: { 'content-type': 'application/timestamp-reply' } })
    }) as typeof globalThis.fetch
}

describe('PDF の電子署名', () => {
    it('自己署名の証明書を作り、内容を読める', async () => {
        const { cert } = await createSelfSigned({ name: '見本 太郎', org: '見本株式会社', email: 'taro@example.com', years: 2 })
        const s = await certSummary(cert)
        expect(s.subject).toBe('見本 太郎 / 見本株式会社')
        expect(s.email).toBe('taro@example.com')
        expect(s.selfSigned).toBe(true)
        expect(s.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
        const years = (Date.parse(s.notAfter) - Date.parse(s.notBefore)) / (365 * 86_400_000)
        expect(Math.round(years)).toBe(2)
    })

    it('名前のない証明書は作らない', async () => {
        await expect(createSelfSigned({ name: '  ' })).rejects.toThrow('証明書の名前')
    })

    it('期限の外の証明書は断る', async () => {
        const { cert } = await createSelfSigned({ name: 'A' })
        const s = await certSummary(cert)
        expect(() => assertValid(s, new Date(Date.parse(s.notAfter) + 1000))).toThrow('有効期限が切れています')
        expect(() => assertValid(s, new Date(Date.parse(s.notBefore) - 1000))).toThrow('有効期間の開始前')
    })

    it('Chromium の書き出した PDF に PAdES（ETSI.CAdES.detached）で署名し、pkijs で検証できる', async () => {
        const { key, cert } = await createSelfSigned({ name: '見本 太郎' })
        const out = await signPdf(PRINTED, { signer: await keySigner(key, cert), reason: '承認', location: '東京' })
        expect(Buffer.from(out.subarray(0, PRINTED.length)).equals(Buffer.from(PRINTED))).toBe(true)
        const { signed, cms, dict } = lastSignature(out)
        expect(dict).toContain('/ETSI.CAdES.detached')
        const { ok, attrs } = await verifyCms(cms, signed)
        expect(ok).toBe(true)
        expect(attrs).toContain('1.2.840.113549.1.9.16.2.47')
        expect(attrs).not.toContain('1.2.840.113549.1.9.5')
    })

    it('署名した後に 1 バイトでも変えると検証に失敗する', async () => {
        const { key, cert } = await createSelfSigned({ name: 'A' })
        const out = await signPdf(PRINTED, { signer: await keySigner(key, cert) })
        const { signed, cms } = lastSignature(out)
        signed[200] ^= 1
        expect((await verifyCms(cms, signed)).ok).toBe(false)
    })

    it.skipIf(!has('openssl'))('openssl の cms -verify も通る', async () => {
        const { key, cert } = await createSelfSigned({ name: 'A' })
        const out = await signPdf(PRINTED, { signer: await keySigner(key, cert) })
        const { signed, cms } = lastSignature(out)
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-pdfsig-'))
        fs.writeFileSync(join(dir, 'sig.der'), cms)
        fs.writeFileSync(join(dir, 'data.bin'), signed)
        const r = execFileSync(
            'openssl',
            ['cms', '-verify', '-inform', 'DER', '-in', join(dir, 'sig.der'), '-binary', '-content', join(dir, 'data.bin'), '-noverify', '-out', '/dev/null'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        expect(r).toBeDefined()
    })

    describe.skipIf(!has('openssl'))('.p12 の読み込み', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-p12-'))
        const make = (name: string, legacy: boolean) => {
            const key = join(dir, `${name}.key`)
            const crt = join(dir, `${name}.crt`)
            const p12 = join(dir, `${name}.p12`)
            execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30', '-subj', `/CN=${name}`], {
                stdio: 'ignore',
            })
            execFileSync('openssl', ['pkcs12', '-export', ...(legacy ? ['-legacy'] : []), '-inkey', key, '-in', crt, '-out', p12, '-passout', 'pass:secret'], {
                stdio: 'ignore',
            })
            return new Uint8Array(fs.readFileSync(p12))
        }

        it('OpenSSL 3 の既定の形式（AES・PBKDF2）で署名できる', async () => {
            const signer = await p12Signer(make('modern', false), 'secret')
            expect((await certSummary(signer.certificate)).subject).toBe('modern')
            const out = await signPdf(PRINTED, { signer })
            const { signed, cms } = lastSignature(out)
            expect((await verifyCms(cms, signed)).ok).toBe(true)
        })

        it('古い形式（RC2・3DES）も読める', async () => {
            let legacy: Uint8Array
            try {
                legacy = make('legacy', true)
            } catch {
                return
            }
            const signer = await p12Signer(legacy, 'secret')
            expect((await certSummary(signer.certificate)).subject).toBe('legacy')
        })

        it('パスワードが違うと決まったエラーになる', async () => {
            await expect(p12Signer(make('wrong', false), 'nope')).rejects.toThrow('パスワードが不正')
        })
    })

    it('時刻認証局のタイムスタンプを署名に入れる（B-T）', async () => {
        const seen: Record<string, string>[] = []
        const fetch = await fakeTsa(seen)
        const { key, cert } = await createSelfSigned({ name: 'A' })
        const out = await signPdf(PRINTED, {
            signer: await keySigner(key, cert),
            tsa: { url: 'https://tsa.example.com/tsr', headers: { Authorization: 'Basic dXNlcjpwYXNz' }, fetch },
        })
        const { signed, cms } = lastSignature(out)
        const { ok, unsigned, sd } = await verifyCms(cms, signed)
        expect(ok).toBe(true)
        expect(unsigned).toContain('1.2.840.113549.1.9.16.2.14')
        expect(seen[0].authorization).toBe('Basic dXNlcjpwYXNz')
        const tokenAttr = sd.signerInfos[0].unsignedAttrs!.attributes.find((a) => a.type === '1.2.840.113549.1.9.16.2.14')!
        const token = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: tokenAttr.values[0] }).content })
        const tst = new pkijs.TSTInfo({ schema: asn1js.fromBER(token.encapContentInfo.eContent!.getValue()).result })
        const sigValue = sd.signerInfos[0].signature.valueBlock.valueHexView
        const imprint = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(sigValue)))
        expect(Buffer.from(tst.messageImprint.hashedMessage.valueBlock.valueHexView).equals(Buffer.from(imprint))).toBe(true)
    })

    it('時刻認証局が答えないときは TsaError にする', async () => {
        const { key, cert } = await createSelfSigned({ name: 'A' })
        const fetch = (async () => new Response('busy', { status: 503 })) as typeof globalThis.fetch
        await expect(signPdf(PRINTED, { signer: await keySigner(key, cert), tsa: { url: 'https://tsa.example.com', fetch } })).rejects.toBeInstanceOf(TsaError)
    })
})
