export function toPlain<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T
}

export function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}
