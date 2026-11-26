import { afterEach, describe, expect, it } from 'vitest'
import { fmtDate } from '../src/renderer/utils/format'

const original = process.env.TZ
afterEach(() => {
	process.env.TZ = original
})

describe('日付の表示', () => {
	it('日付だけの文字列は、時差のある環境でも同じ日に表示する', () => {
		for (const tz of ['Asia/Tokyo', 'America/Los_Angeles', 'Europe/London']) {
			process.env.TZ = tz
			expect(fmtDate('2026-12-20', 'ymd'), tz).toBe('2026/12/20')
			expect(fmtDate('2026-01-01', 'md'), tz).toBe('1/1')
		}
	})
})
