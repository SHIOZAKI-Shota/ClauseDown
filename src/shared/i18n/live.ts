// 読むたびに今の言語の文字列を返すオブジェクト。Record<K, string> としてそのまま使える
export function liveRecord<K extends string>(keys: readonly K[], get: (key: K) => string): Record<K, string> {
	const out = {} as Record<K, string>
	for (const key of keys) Object.defineProperty(out, key, { get: () => get(key), enumerable: true })
	return out
}
