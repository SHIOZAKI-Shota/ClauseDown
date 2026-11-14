import { ungzip } from 'pako'

class Gunzip {
    constructor(private data: Uint8Array) {}
    decompress(): Uint8Array {
        return ungzip(this.data)
    }
}

export const Zlib = { Gunzip }
export default { Zlib }
