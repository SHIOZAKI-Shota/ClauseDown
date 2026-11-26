import { describe, expect, it } from 'vitest'
import { shownParentsOf } from '../src/main/git'

function naive(parentsOf: (oid: string) => readonly string[], shown: Set<string>, oid: string): string[] {
	const out: string[] = []
	const seen = new Set<string>()
	for (const direct of parentsOf(oid)) {
		const stack = [direct]
		while (stack.length) {
			const p = stack.pop()!
			if (seen.has(p)) continue
			seen.add(p)
			if (shown.has(p)) {
				if (!out.includes(p)) out.push(p)
			} else stack.push(...[...parentsOf(p)].reverse())
		}
	}
	return out
}

function randomDag(n: number, seed: number) {
	let x = seed
	const rnd = () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
	const parents = new Map<string, string[]>()
	for (let i = 0; i < n; i++) {
		const ps: string[] = []
		if (i + 1 < n) ps.push(`c${i + 1}`)
		if (i + 2 < n && rnd() < 0.3) ps.push(`c${i + 2 + Math.floor(rnd() * Math.min(20, n - i - 2))}`)
		parents.set(`c${i}`, [...new Set(ps)])
	}
	const shown = new Set([...parents.keys()].filter(() => rnd() < 0.2))
	return { parentsOf: (o: string) => parents.get(o) ?? [], shown }
}

describe('履歴の絞り込みでの親の付け替え', () => {
	it('表示しない版を飛ばした親が、素朴な探索と同じ順で求まる', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const { parentsOf, shown } = randomDag(300, seed)
			const fast = shownParentsOf(parentsOf, shown)
			for (const oid of shown) expect(fast(oid), `${seed} ${oid}`).toEqual(naive(parentsOf, shown, oid))
		}
	})

	it('長い一直線の履歴でもスタックがあふれない', () => {
		const n = 50_000
		const parentsOf = (o: string) => {
			const i = Number(o.slice(1))
			return i + 1 < n ? [`c${i + 1}`] : []
		}
		expect(shownParentsOf(parentsOf, new Set(['c0', `c${n - 1}`]))('c0')).toEqual([`c${n - 1}`])
	})
})
