import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dsseSign, dsseVerify, verifyReviewEvent } from '../src/main/attest'
import { commitPayload, generateSshKey, loadSshKey, NS_GIT, sshSign, sshVerify, stripTagSignature, tagPayload } from '../src/main/ssh-sig'
import { pae, reviewStatement } from '../src/shared/attestation'
import type { ReviewEvent } from '../src/shared/review'

const has = (cmd: string, args: string[]) => {
    try {
        execFileSync(cmd, args, { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}
const HAS_SSH = has('ssh-keygen', ['-?']) || fs.existsSync('/usr/bin/ssh-keygen')

describe('SSH の署名（SSHSIG）', () => {
    it('署名して検証でき、名前空間の違いや改ざんでは失敗する', () => {
        const k = generateSshKey()
        expect(k.publicKey).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5/)
        expect(k.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
        const key = loadSshKey(k.pem)
        const sig = sshSign('tree abc\n\nmessage\n', key, NS_GIT)
        expect(sig).toMatch(/^-----BEGIN SSH SIGNATURE-----\n[\s\S]+\n-----END SSH SIGNATURE-----$/)
        expect(sshVerify(sig, 'tree abc\n\nmessage\n', NS_GIT)).toEqual({ ok: true, fingerprint: k.fingerprint, publicKey: k.publicKey })
        expect(sshVerify(sig, 'tree abd\n\nmessage\n', NS_GIT).ok).toBe(false)
        expect(sshVerify(sig, 'tree abc\n\nmessage\n', 'file').ok).toBe(false)
        expect(sshVerify('garbage', 'x', NS_GIT).ok).toBe(false)
    })

    it.skipIf(!HAS_SSH)('ssh-keygen -Y verify が Good と答える', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-sshsig-'))
        const k = generateSshKey()
        const msg = 'hello clause\n'
        fs.writeFileSync(join(dir, 'msg'), msg)
        fs.writeFileSync(join(dir, 'msg.sig'), sshSign(msg, loadSshKey(k.pem), NS_GIT) + '\n')
        fs.writeFileSync(join(dir, 'allowed'), `me@example.com ${k.publicKey}\n`)
        const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', join(dir, 'allowed'), '-I', 'me@example.com', '-n', 'git', '-s', join(dir, 'msg.sig')], {
            input: msg,
        }).toString()
        expect(out).toContain('Good "git" signature')
    })

    it.skipIf(!HAS_SSH)('ssh-keygen が作った RSA・ECDSA の署名も検証できる', () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-sshkeys-'))
        const msg = 'tree 123\n\nhi\n'
        fs.writeFileSync(join(dir, 'msg'), msg)
        for (const [t, bits] of [
            ['rsa', '3072'],
            ['ecdsa', '256'],
            ['ecdsa', '384'],
            ['ed25519', ''],
        ]) {
            const key = join(dir, `${t}${bits}`)
            execFileSync('ssh-keygen', ['-q', '-t', t, ...(bits ? ['-b', bits] : []), '-N', '', '-f', key], { stdio: 'ignore' })
            execFileSync('ssh-keygen', ['-Y', 'sign', '-n', 'git', '-f', key, join(dir, 'msg')], { stdio: 'ignore' })
            const sig = fs.readFileSync(join(dir, 'msg.sig'), 'utf8')
            fs.rmSync(join(dir, 'msg.sig'))
            const pub = fs.readFileSync(`${key}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ')
            const r = sshVerify(sig, msg, 'git')
            expect(r.ok, `${t}${bits}`).toBe(true)
            expect(r.publicKey).toBe(pub)
            expect(sshVerify(sig, msg + 'x', 'git').ok).toBe(false)
        }
    })

    it('コミットとタグから署名を除いた中身を取り出す', () => {
        const raw = 'tree t\nparent p\nauthor a 1 +0900\ncommitter a 1 +0900\ngpgsig -----BEGIN SSH SIGNATURE-----\n abc\n -----END SSH SIGNATURE-----\n\nmsg\n'
        expect(commitPayload(raw)).toEqual({
            payload: 'tree t\nparent p\nauthor a 1 +0900\ncommitter a 1 +0900\n\nmsg\n',
            signature: '-----BEGIN SSH SIGNATURE-----\nabc\n-----END SSH SIGNATURE-----',
        })
        expect(commitPayload('tree t\n\nmsg\n')).toEqual({ payload: 'tree t\n\nmsg\n', signature: null })
        const tag =
            'object o\ntype commit\ntag 施行/x\ntagger a 1 +0900\n\n施行日: 2026-04-01\n-----BEGIN SSH SIGNATURE-----\nabc\n-----END SSH SIGNATURE-----\n'
        expect(tagPayload(tag).payload).toBe('object o\ntype commit\ntag 施行/x\ntagger a 1 +0900\n\n施行日: 2026-04-01\n')
        expect(stripTagSignature('施行日: 2026-04-01\n-----BEGIN SSH SIGNATURE-----\nabc\n-----END SSH SIGNATURE-----\n')).toBe('施行日: 2026-04-01\n')
    })
})

describe('承認の証明（in-toto ＋ DSSE）', () => {
    it('PAE は DSSE の仕様どおり', () => {
        expect(Buffer.from(pae('http://example.com/HelloWorld', Buffer.from('hello world'))).toString()).toBe(
            'DSSEv1 29 http://example.com/HelloWorld 11 hello world',
        )
        expect(Buffer.from(pae('型', Buffer.from('あ'))).toString()).toBe('DSSEv1 3 型 3 あ')
    })

    const event: ReviewEvent = {
        id: 'r1',
        branch: '案/改正',
        action: 'approve',
        oid: 'a'.repeat(40),
        by: '山田',
        byLogin: 'yamada',
        at: '2026-11-15T01:00:00.000Z',
        text: '確認しました',
    }

    it('署名した承認は検証でき、版・ブランチ・操作を変えると通らない', () => {
        const key = loadSshKey(generateSshKey().pem)
        const { envelope, publicKey } = dsseSign(reviewStatement(event, 'root'), key)
        const signed = { ...event, attestation: envelope, publicKey }
        expect(verifyReviewEvent(signed, 'root').ok).toBe(true)
        expect(verifyReviewEvent({ ...signed, oid: 'b'.repeat(40) }, 'root').ok).toBe(false)
        expect(verifyReviewEvent({ ...signed, branch: '案/別' }, 'root').ok).toBe(false)
        expect(verifyReviewEvent({ ...signed, action: 'changes' }, 'root').ok).toBe(false)
        expect(verifyReviewEvent(signed, 'other-repo').ok).toBe(false)
        expect(verifyReviewEvent({ ...signed, publicKey: generateSshKey().publicKey }, 'root').ok).toBe(false)
        const tampered = {
            ...envelope,
            payload: Buffer.from(
                JSON.stringify({ ...reviewStatement(event, 'root'), predicate: { ...reviewStatement(event, 'root').predicate, by: '偽' } }),
            ).toString('base64'),
        }
        expect(dsseVerify(tampered, publicKey).ok).toBe(false)
    })
})
