import { inflateRawSync } from 'node:zlib'

export function readZipEntry(zip: Buffer, name: string): string {
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    let at = zip.readUInt32LE(eocd + 16)
    const count = zip.readUInt16LE(eocd + 10)
    for (let i = 0; i < count; i++) {
        const method = zip.readUInt16LE(at + 10)
        const size = zip.readUInt32LE(at + 20)
        const nameLen = zip.readUInt16LE(at + 28)
        const extra = zip.readUInt16LE(at + 30)
        const comment = zip.readUInt16LE(at + 32)
        const local = zip.readUInt32LE(at + 42)
        if (zip.toString('utf8', at + 46, at + 46 + nameLen) === name) {
            const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
            const data = zip.subarray(start, start + size)
            return (method === 8 ? inflateRawSync(data) : data).toString('utf8')
        }
        at += 46 + nameLen + extra + comment
    }
    throw new Error(`${name} がありません`)
}
