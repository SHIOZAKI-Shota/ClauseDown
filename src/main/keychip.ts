import { createPublicKey, randomBytes } from 'node:crypto'
import { errText } from './util'
import { t } from '../shared/i18n'
import { loadNative } from './native'
import { blobOfPublicKey, p256Blob, publicBlob, type KeySigner } from './ssh-sig'

export interface ChipCreated {
    algorithm: string
    handle: Buffer
    publicKey: Buffer
}

export interface KeychipNative {
    available(): Promise<boolean>
    create(name: string, presence: boolean): Promise<ChipCreated>
    sign(handle: Buffer, data: Buffer, reason: string): Promise<Buffer>
    remove(handle: Buffer): Promise<void>
    forget(): void
}

export interface ChipKey {
    algorithm: 'p256' | 'rsa2048'
    handle: string
}

let native: KeychipNative | null | undefined
let availability: Promise<boolean> | null = null

function load(): KeychipNative | null {
    if (native === undefined) native = loadNative<KeychipNative>('keychip')
    return native
}

export function setKeychipNative(n: KeychipNative | null): void {
    native = n
    availability = null
}

export function chipAvailable(): Promise<boolean> {
    const n = load()
    if (!n) return Promise.resolve(false)
    availability ??= n.available().catch(() => false)
    return availability
}

const fail = (e: unknown) => new Error(errText(e) === 'cancelled' ? t().signing.errors.chipCancelled : t().signing.errors.chip(errText(e)))

export async function createChipKey(): Promise<{ key: ChipKey; blob: Buffer }> {
    const n = load()
    if (!n || !(await chipAvailable())) throw new Error(t().signing.errors.chipMissing)
    let made: ChipCreated
    try {
        made = await n.create(`ClauseDown-${randomBytes(8).toString('hex')}`, true)
    } catch (e) {
        throw fail(e)
    }
    const algorithm = made.algorithm === 'rsa2048' ? 'rsa2048' : 'p256'
    const blob =
        algorithm === 'p256'
            ? p256Blob(Buffer.from(made.publicKey))
            : publicBlob(createPublicKey({ key: Buffer.from(made.publicKey), format: 'der', type: 'spki' }))
    return { key: { algorithm, handle: Buffer.from(made.handle).toString('base64') }, blob }
}

export async function removeChipKey(key: ChipKey): Promise<void> {
    const n = load()
    if (!n) return
    await n.remove(Buffer.from(key.handle, 'base64')).catch(() => {})
    n.forget()
}

export function chipSigner(key: ChipKey, publicKey: string): KeySigner | null {
    const blob = blobOfPublicKey(publicKey)
    const n = load()
    if (!blob || !n) return null
    const handle = Buffer.from(key.handle, 'base64')
    return {
        blob,
        storage: 'chip',
        async sign(data) {
            try {
                return Buffer.from(await n.sign(handle, Buffer.from(data), t().signing.chip.reason))
            } catch (e) {
                throw fail(e)
            }
        },
    }
}

export function parseChipKey(raw: string | null): ChipKey | null {
    if (!raw) return null
    try {
        const v = JSON.parse(raw) as Partial<ChipKey>
        if ((v.algorithm === 'p256' || v.algorithm === 'rsa2048') && typeof v.handle === 'string' && v.handle)
            return { algorithm: v.algorithm, handle: v.handle }
    } catch {}
    return null
}
