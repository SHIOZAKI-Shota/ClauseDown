export function toPlain<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T
}

export const ipcError = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}
