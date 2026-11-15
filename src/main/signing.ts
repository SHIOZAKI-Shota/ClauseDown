import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { delimiter, join } from 'node:path'
import { t } from '../shared/i18n'
import { DEFAULT_SIGNING, type SigningSettings, type SshKeyInfo } from '../shared/signing'
import { loadSecret, loadSettings, saveSecret, updateSettings } from './settings'
import { generateSshKey, loadSshKey, NS_GIT, sshSign, type SshKeyPair } from './ssh-sig'

export type SignPurpose = 'commit' | 'tag' | 'record'

export interface SignOpts {
    signingKey?: string
    onSign?: (args: { payload: string; secretKey: string }) => Promise<{ signature: string }>
}

const EXTRA_PATH =
    process.platform === 'win32'
        ? ['C:\\Windows\\System32\\OpenSSH', 'C:\\Program Files\\Git\\usr\\bin', 'C:\\Program Files (x86)\\GnuPG\\bin', 'C:\\Program Files\\GnuPG\\bin']
        : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/local/MacGPG2/bin', '/usr/bin', '/bin']

const toolEnv = () => ({ ...process.env, PATH: [process.env.PATH ?? '', ...EXTRA_PATH].filter(Boolean).join(delimiter) })

let keyCache: { pem: string; pair: SshKeyPair } | null = null

export async function signingSettings(): Promise<SigningSettings> {
    return (await loadSettings()).signing ?? DEFAULT_SIGNING
}

export async function appKey(): Promise<SshKeyPair | null> {
    const pem = await loadSecret('sign-ssh-key')
    if (!pem) return null
    if (keyCache?.pem !== pem) keyCache = { pem, pair: loadSshKey(pem) }
    return keyCache.pair
}

export async function generateSigningKey(): Promise<SshKeyInfo> {
    const k = generateSshKey()
    await saveSecret('sign-ssh-key', k.pem)
    keyCache = null
    const info: SshKeyInfo = { fingerprint: k.fingerprint, publicKey: k.publicKey, createdAt: new Date().toISOString() }
    await updateSettings((s) => {
        const signing = s.signing ?? structuredClone(DEFAULT_SIGNING)
        signing.commit = { ...signing.commit, key: info, registered: {} }
        return { ...s, signing }
    })
    return info
}

export async function deleteSigningKey(): Promise<void> {
    await saveSecret('sign-ssh-key', '')
    keyCache = null
    await updateSettings((s) => {
        const signing = s.signing ?? structuredClone(DEFAULT_SIGNING)
        signing.commit = { ...signing.commit, key: undefined, registered: {} }
        return { ...s, signing }
    })
}

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { cwd: opts.cwd, env: toolEnv(), windowsHide: true })
        let stdout = ''
        let stderr = ''
        const timer = setTimeout(() => p.kill(), 60_000)
        p.stdout.on('data', (d) => (stdout += d))
        p.stderr.on('data', (d) => (stderr += d))
        p.on('error', (e) => {
            clearTimeout(timer)
            reject(e)
        })
        p.on('close', (code) => {
            clearTimeout(timer)
            if (code === 0) resolve({ stdout, stderr })
            else reject(new Error(stderr.trim().split('\n').at(-1) || `${cmd} exited with ${code}`))
        })
        p.stdin.end(opts.input ?? '')
    })
}

function gitConfig(dir: string | undefined, key: string): Promise<string> {
    return new Promise((resolve) => {
        execFile('git', ['config', '--get', key], { cwd: dir, env: toolEnv(), windowsHide: true }, (err, out) => resolve(err ? '' : out.trim()))
    })
}

export interface ExternalConfig {
    format: 'ssh' | 'openpgp' | 'x509'
    key: string
    program: string
}

export async function externalConfig(dir?: string): Promise<ExternalConfig | null> {
    const key = await gitConfig(dir, 'user.signingkey')
    if (!key) return null
    const raw = (await gitConfig(dir, 'gpg.format')) || 'openpgp'
    const format = raw === 'ssh' || raw === 'x509' ? raw : 'openpgp'
    const program =
        format === 'ssh'
            ? (await gitConfig(dir, 'gpg.ssh.program')) || 'ssh-keygen'
            : (await gitConfig(dir, `gpg.${format}.program`)) || (await gitConfig(dir, 'gpg.program')) || 'gpg'
    return { format, key, program }
}

const home = (p: string) => (p.startsWith('~/') ? join(os.homedir(), p.slice(2)) : p)

async function externalSign(cfg: ExternalConfig, payload: string, cwd?: string): Promise<string> {
    if (cfg.format === 'x509') throw new Error(t().signing.errors.x509)
    try {
        if (cfg.format === 'openpgp') return (await run(cfg.program, ['--status-fd=2', '-bsau', cfg.key], { cwd, input: payload })).stdout
        const tmp = await fs.mkdtemp(join(os.tmpdir(), 'clausedown-sign-'))
        try {
            const file = join(tmp, 'payload')
            await fs.writeFile(file, payload)
            const literal = cfg.key.startsWith('key::') ? cfg.key.slice(5) : /^(ssh-|ecdsa-|sk-)/.test(cfg.key) ? cfg.key : null
            let keyArgs: string[]
            if (literal) {
                const pub = join(tmp, 'key.pub')
                await fs.writeFile(pub, `${literal}\n`)
                keyArgs = ['-f', pub, '-U']
            } else if (cfg.key.endsWith('.pub')) keyArgs = ['-f', home(cfg.key), '-U']
            else keyArgs = ['-f', home(cfg.key)]
            await run(cfg.program, ['-Y', 'sign', '-n', NS_GIT, ...keyArgs, file], { cwd })
            return await fs.readFile(`${file}.sig`, 'utf8')
        } finally {
            await fs.rm(tmp, { recursive: true, force: true })
        }
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(t().signing.errors.toolMissing(cfg.program))
        throw new Error(t().signing.errors.external((e as Error).message))
    }
}

export async function testExternalSigning(dir?: string): Promise<ExternalConfig> {
    const cfg = await externalConfig(dir)
    if (!cfg) throw new Error(t().signing.errors.externalNotSet)
    await externalSign(cfg, 'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n\nClauseDown signing test\n', dir)
    return cfg
}

export async function signOpts(dir: string, purpose: SignPurpose): Promise<SignOpts> {
    const s = await signingSettings()
    if (s.commit.mode === 'off') return {}
    if (s.commit.mode === 'app') {
        if (!s.commit.key) return {}
        const key = await appKey()
        if (!key) return {}
        return { signingKey: 'clausedown', onSign: async ({ payload }) => ({ signature: sshSign(payload, key, NS_GIT) }) }
    }
    if (purpose === 'record') return {}
    const cfg = await externalConfig(dir)
    if (!cfg) return {}
    return { signingKey: cfg.key, onSign: async ({ payload }) => ({ signature: await externalSign(cfg, payload, dir) }) }
}
