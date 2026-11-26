export function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): V {
	if (map.size >= max) map.clear()
	map.set(key, value)
	return value
}

export function recent<K, V>(map: Map<K, V>, key: K, make: () => V, max: number): V {
	let v = map.get(key)
	if (v === undefined) v = make()
	else map.delete(key)
	map.set(key, v)
	while (map.size > max) map.delete(map.keys().next().value!)
	return v
}
