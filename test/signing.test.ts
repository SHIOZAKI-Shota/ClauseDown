import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { generateSshKey } from '../src/main/ssh-sig'
import { DEFAULT_SIGNING, type SigningSettings } from '../src/shared/signing'

const key = generateSshKey()
const state: { signing: SigningSettings; secret: string | null } = {
    signing: { ...structuredClone(DEFAULT_SIGNING), commit: { ...DEFAULT_SIGNING.commit, mode: 'app', key: { ...key, createdAt: '' } } },
    secret: key.pem,
}

vi.mock('../src/main/settings', () => ({
    getToken: async () => null,
    loadSettings: async () => ({ repos: [], author: { name: 'テスト', email: 't@example.com' }, username: '', signing: state.signing }),
    loadSecret: async () => state.secret,
    saveSecret: async () => {},
    updateSettings: async () => {},
}))

const git = await import('../src/main/git')
const records = await import('../src/main/records')
const signing = await import('../src/main/signing')

const HAS_GIT = (() => {
    try {
        execFileSync('git', ['--version'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()

function realGit(dir: string, args: string[]) {
    const allowed = join(dir, '.git', 'allowed_signers')
    fs.writeFileSync(allowed, `t@example.com ${key.publicKey}\n`)
    return execFileSync('git', ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${allowed}`, ...args], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    }).toString()
}

describe('版の署名（アプリの鍵）', () => {
    let dir: string
    beforeAll(async () => {
        dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-sign-'))
        await git.initRepo(dir)
        await git.createDoc(dir, '規程.md', '規程')
        await git.saveVersion(dir, { message: '初版', effectiveDate: '2026-04-01', docPath: '規程.md' })
        await records.writeRecord(dir, 'reviews/r1.json', { id: 'r1' })
    })

    it('版の保存・施行日のタグ・記録のコミットに SSH の署名が入る', async () => {
        const head = await git.log(dir, '規程.md')
        expect(head[0].message).toContain('施行日: 2026-04-01')
        const raw = execFileSync('git', ['cat-file', 'commit', 'HEAD'], { cwd: dir }).toString()
        expect(raw).toContain('gpgsig -----BEGIN SSH SIGNATURE-----')
    })

    it.skipIf(!HAS_GIT)('本物の git が署名を確かめられる（verify-commit・verify-tag・記録のブランチ）', () => {
        expect(() => realGit(dir, ['verify-commit', 'HEAD'])).not.toThrow()
        const tag = execFileSync('git', ['tag', '--list', '施行/*'], { cwd: dir }).toString().trim()
        expect(tag).toBe('施行/規程/2026-04-01')
        expect(() => realGit(dir, ['verify-tag', tag])).not.toThrow()
        const log = realGit(dir, ['log', '--format=%G?', 'refs/heads/clausedown-records'])
        expect(log.trim().split('\n')[0]).toBe('G')
    })

    it.skipIf(!HAS_GIT)('書き出した鍵の一覧（allowed_signers）で、本物の git が版の署名を確認できる', async () => {
        const { allowedSigners } = await import('../src/main/verify')
        const text = await allowedSigners(dir)
        expect(text).toContain(`t@example.com namespaces="git" ${key.publicKey}`)
        const file = join(dir, '.git', 'exported_signers')
        fs.writeFileSync(file, text)
        const out = execFileSync('git', ['-c', 'gpg.format=ssh', '-c', `gpg.ssh.allowedSignersFile=${file}`, 'verify-commit', 'HEAD'], {
            cwd: dir,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        expect(out).toBeDefined()
    })

    it('改ざんした版は git が受け付けない', () => {
        if (!HAS_GIT) return
        const raw = execFileSync('git', ['cat-file', 'commit', 'HEAD'], { cwd: dir }).toString().replace('初版', '偽版')
        const forged = execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: dir, input: raw }).toString().trim()
        expect(() => realGit(dir, ['verify-commit', forged])).toThrow()
    })

    it('鍵を作るまでは署名しない（既存の利用者の動きは変わらない）', async () => {
        const saved = state.signing
        state.signing = structuredClone(DEFAULT_SIGNING)
        expect(await signing.signOpts(dir, 'commit')).toEqual({})
        state.signing = { ...saved, commit: { ...saved.commit, mode: 'off' } }
        expect(await signing.signOpts(dir, 'commit')).toEqual({})
        state.signing = saved
    })
})

describe.skipIf(!HAS_GIT)('版の署名（この PC の Git の設定）', () => {
    it('ssh-keygen で作った鍵で署名し、本物の git が確かめられる', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-extsign-'))
        await git.initRepo(dir)
        const keyFile = join(dir, '.git', 'id_test')
        execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyFile], { stdio: 'ignore' })
        execFileSync('git', ['config', 'gpg.format', 'ssh'], { cwd: dir })
        execFileSync('git', ['config', 'user.signingkey', keyFile], { cwd: dir })
        const saved = state.signing
        state.signing = { ...saved, commit: { ...saved.commit, mode: 'external' } }
        try {
            const cfg = await signing.testExternalSigning(dir)
            expect(cfg).toMatchObject({ format: 'ssh', key: keyFile })
            await git.createDoc(dir, 'a.md', 'A')
            await git.saveVersion(dir, { message: '外の鍵で保存' })
            const pub = fs.readFileSync(`${keyFile}.pub`, 'utf8').trim()
            const allowed = join(dir, '.git', 'allowed')
            fs.writeFileSync(allowed, `t@example.com ${pub}\n`)
            expect(() =>
                execFileSync('git', ['-c', `gpg.ssh.allowedSignersFile=${allowed}`, 'verify-commit', 'HEAD'], { cwd: dir, stdio: 'ignore' }),
            ).not.toThrow()
            expect(await signing.signOpts(dir, 'record')).toEqual({})
        } finally {
            state.signing = saved
        }
    })

    it('鍵が設定されていなければ分かるエラーにする', async () => {
        const dir = fs.mkdtempSync(join(os.tmpdir(), 'clausedown-nokey-'))
        await git.initRepo(dir)
        execFileSync('git', ['config', 'user.signingkey', ''], { cwd: dir })
        await expect(signing.testExternalSigning(dir)).rejects.toThrow()
    })
})
