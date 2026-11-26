import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { cleanSigning, LEGACY_CERT_ID, MAX_PDF_CERTS, resolveCert, type CertInfo } from '../src/shared/signing'

const cert = (subject: string): CertInfo => ({
	subject,
	issuer: subject,
	email: '',
	notBefore: '2026-01-01T00:00:00.000Z',
	notAfter: '2029-01-01T00:00:00.000Z',
	selfSigned: true,
	fingerprint: 'AA:BB',
})

describe('PDF の証明書の一覧', () => {
	it('旧形式の証明書ファイルを一覧の 1 件目に移し、既定にする', () => {
		const s = cleanSigning({ pdf: { method: 'p12', cert: cert('山田 太郎') } })
		expect(s.pdf.certs).toEqual([{ id: LEGACY_CERT_ID.p12, label: '山田 太郎', kind: 'p12', cert: cert('山田 太郎') }])
		expect(s.pdf.defaultCert).toBe(LEGACY_CERT_ID.p12)
	})

	it('旧形式の自己署名とマイナンバーカードも移し、「しない」は 0 件にする', () => {
		expect(cleanSigning({ pdf: { method: 'self', cert: cert('A'), selfCert: 'AAAA' } }).pdf.certs[0]).toMatchObject({
			id: LEGACY_CERT_ID.self,
			kind: 'self',
			selfCert: 'AAAA',
		})
		expect(cleanSigning({ pdf: { method: 'myna' } }).pdf.certs[0]).toMatchObject({ id: LEGACY_CERT_ID.myna, kind: 'myna' })
		expect(cleanSigning({ pdf: { method: 'none' } }).pdf.certs).toEqual([])
		expect(cleanSigning({ pdf: { method: 'self', cert: cert('A') } }).pdf.certs).toEqual([])
	})

	it('不正な id・種類・重複したマイナンバーカードを除き、件数の上限を守る', () => {
		const ok = (id: string) => ({ id, label: id, kind: 'p12', cert: cert(id) })
		const s = cleanSigning({
			pdf: {
				certs: [
					{ id: '../../evil00', label: 'x', kind: 'p12', cert: cert('x') },
					{ id: 'aaaaaaaaaaaa', label: 'x', kind: 'rsa', cert: cert('x') },
					{ id: 'bbbbbbbbbbbb', label: 'x', kind: 'p12' },
					{ id: 'mynamynamyna', label: '', kind: 'myna' },
					{ id: 'mynamyna0002', label: '', kind: 'myna' },
					...Array.from({ length: 15 }, (_, i) => ok(`cert${String(i).padStart(8, '0')}`)),
				],
			},
		})
		expect(s.pdf.certs.map((c) => c.id)).not.toContain('../../evil00')
		expect(s.pdf.certs.filter((c) => c.kind === 'myna')).toHaveLength(1)
		expect(s.pdf.certs).toHaveLength(MAX_PDF_CERTS)
		expect(s.pdf.certs.some((c) => c.id === 'aaaaaaaaaaaa' || c.id === 'bbbbbbbbbbbb')).toBe(false)
	})

	it('存在しない証明書を指す既定とリポジトリの既定は外す', () => {
		const s = cleanSigning({
			pdf: {
				certs: [{ id: 'aaaaaaaaaaaa', label: 'A', kind: 'p12', cert: cert('A') }],
				defaultCert: 'zzzzzzzzzzzz',
				repoCerts: { '/r1': 'aaaaaaaaaaaa', '/r2': 'zzzzzzzzzzzz' },
			},
		})
		expect(s.pdf.defaultCert).toBeUndefined()
		expect(s.pdf.repoCerts).toEqual({ '/r1': 'aaaaaaaaaaaa' })
	})

	it('使う証明書は、リポジトリの既定 → アプリ全体の既定 → 先頭の順で決まる', () => {
		const s = cleanSigning({
			pdf: {
				certs: [
					{ id: 'aaaaaaaaaaaa', label: 'A', kind: 'p12', cert: cert('A') },
					{ id: 'bbbbbbbbbbbb', label: 'B', kind: 'p12', cert: cert('B') },
					{ id: 'cccccccccccc', label: 'C', kind: 'p12', cert: cert('C') },
				],
				defaultCert: 'bbbbbbbbbbbb',
				repoCerts: { '/corp': 'cccccccccccc' },
			},
		})
		expect(resolveCert(s.pdf, '/corp')?.id).toBe('cccccccccccc')
		expect(resolveCert(s.pdf, '/other')?.id).toBe('bbbbbbbbbbbb')
		expect(resolveCert({ ...s.pdf, defaultCert: undefined })?.id).toBe('aaaaaaaaaaaa')
		expect(resolveCert(cleanSigning({}).pdf)).toBeUndefined()
	})
})

const userData = (await import('node:fs')).mkdtempSync(join((await import('node:os')).tmpdir(), 'cd-secret-'))
vi.mock('electron', () => ({
	app: { getPath: () => userData },
	safeStorage: {
		isEncryptionAvailable: () => true,
		encryptString: (s: string) => Buffer.from(s, 'utf8'),
		decryptString: (b: Buffer) => b.toString('utf8'),
	},
}))

describe('証明書ごとの秘密の保管名', () => {
	it('証明書の id を含む名前は保存・読み込みでき、不正な名前は拒否する', async () => {
		const { loadSecret, saveSecret } = await import('../src/main/settings')
		await saveSecret('sign-pdf-p12-abcdefghij12', 'P12')
		expect(await loadSecret('sign-pdf-p12-abcdefghij12')).toBe('P12')
		await saveSecret('sign-pdf-p12-abcdefghij12', '')
		expect(await loadSecret('sign-pdf-p12-abcdefghij12')).toBeNull()
		for (const bad of ['sign-pdf-p12-../../evil0', 'sign-pdf-p12-ABCDEFGHIJ12', 'sign-pdf-p12-short', 'sign-pdf-cert-abcdefghij12'])
			await expect(saveSecret(bad as never, 'x')).rejects.toThrow()
	})
})
