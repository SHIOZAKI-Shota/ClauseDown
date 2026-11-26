import { describe, expect, it } from 'vitest'
import { buildAxis, monthStarts, packLanes } from '../src/renderer/utils/timeline-layout'
import { dayNum } from '../src/shared/schedule'

const labels = { monthLabel: (y: number, m: number) => `${y}/${m}`, yearLabel: (y: number) => `${y}`, monthShort: (m: number) => `${m}月` }

describe('タイムラインの配置', () => {
	it('月の初日を年をまたいで並べる', () => {
		const ns = monthStarts(dayNum('2026-11-15'), dayNum('2027-02-10'))
		expect(ns).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'].map(dayNum))
	})

	it('重なる予定は別の段に、重ならない予定は同じ段に詰める', () => {
		const items = [
			{ x: 0, w: 50, lane: -1 },
			{ x: 20, w: 50, lane: -1 },
			{ x: 60, w: 10, lane: -1 },
			{ x: 80, w: 10, lane: -1 },
		]
		expect(packLanes(items)).toBe(2)
		expect(items.map((i) => [i.x, i.lane])).toEqual([
			[0, 0],
			[20, 1],
			[60, 0],
			[80, 0],
		])
	})

	it('拡大すると日ごとの目盛り、縮小すると月と年の目盛りになる', () => {
		const left = dayNum('2026-03-01')
		const fine = buildAxis(left, 30, 32, labels)
		expect(fine.minor.some((t) => t.weekend)).toBe(true)
		expect(fine.major[0].label).toMatch(/^2026\//)
		const coarse = buildAxis(left, 900, 0.6, labels)
		expect(coarse.major.some((t) => t.label === '2027')).toBe(true)
		expect(coarse.minor.every((t) => !t.weekend)).toBe(true)
	})
})
