import { constants, createPrivateKey, privateEncrypt } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import * as asn1js from 'asn1js'
import * as pkijs from 'pkijs'
import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/shared/i18n'
import { mynaStatus, openMynaSigner, setMynaNative, type MynaNative } from '../src/main/myna'
import { createSelfSigned, derSlice, signPdf } from '../src/main/pdf-sign'

setLocale('ja')

const PRINTED = new Uint8Array(fs.readFileSync(join(__dirname, 'fixtures/chromium-print.pdf')))
const DIGEST_INFO_SHA256 = Buffer.from('3031300d060960864801650304020105000420', 'hex')

async function fakeCard(log: string[]): Promise<MynaNative> {
    const { key, cert } = await createSelfSigned({ name: 'マイナ 太郎' })
    const pk = createPrivateKey({ key: Buffer.from(key), format: 'der', type: 'pkcs8' })
    return {
        status: async () => ({ available: true, reader: 'Test Reader', card: true, signCert: true, retries: 5 }),
        openSession: async (pin) => {
            log.push(`open:${pin}`)
            if (pin !== 'ABC123') throw new Error('wrong password')
            return {
                certificate: cert,
                caCertificate: new Uint8Array(),
                sign: async (digest) => {
                    log.push(`sign:${digest.length}`)
                    return new Uint8Array(privateEncrypt({ key: pk, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([DIGEST_INFO_SHA256, digest])))
                },
                close: async () => void log.push('close'),
            }
        },
    }
}

afterEach(() => setMynaNative(null))

describe('マイナンバーカードでの署名（カードの代わりの偽物）', () => {
    it('カードが SHA-256 に署名し、PDF の署名として検証できる', async () => {
        const log: string[] = []
        setMynaNative(await fakeCard(log))
        const { signer, close } = await openMynaSigner('abc123')
        const out = await signPdf(PRINTED, { signer })
        await close()
        expect(log).toEqual(['open:ABC123', 'sign:32', 'close'])

        const text = Buffer.from(out).toString('latin1')
        const [a, b, c, d] = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].at(-1)!.slice(1).map(Number)
        const data = Buffer.concat([Buffer.from(out.subarray(a, a + b)), Buffer.from(out.subarray(c, c + d))])
        const cms = derSlice(Buffer.from(text.slice(a + b, c).replace(/[<>\s]/g, ''), 'hex'))
        const sd = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: asn1js.fromBER(cms).result }).content })
        expect(await sd.verify({ signer: 0, data: new Uint8Array(data).buffer, checkChain: false })).toBe(true)
    })

    it('パスワードの形が違えばカードに送らない（残り回数を減らさない）', async () => {
        const log: string[] = []
        setMynaNative(await fakeCard(log))
        await expect(openMynaSigner('12')).rejects.toThrow('6〜16 文字')
        await expect(openMynaSigner('abc-123')).rejects.toThrow('6〜16 文字')
        expect(log).toEqual([])
    })

    it('カードが断ったときは分かるエラーにする', async () => {
        setMynaNative(await fakeCard([]))
        await expect(openMynaSigner('ZZZ999')).rejects.toThrow('マイナンバーカードで署名できませんでした')
    })

    it('状態を返し、ネイティブモジュールがないときは使えないと返す', async () => {
        setMynaNative(await fakeCard([]))
        expect(await mynaStatus()).toEqual({ available: true, reader: 'Test Reader', card: true, signCert: true, retries: 5 })
        setMynaNative(null)
        expect((await mynaStatus()).available).toBe(false)
    })
})
