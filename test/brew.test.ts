import { describe, expect, it } from 'vitest'
import { appBundleOf, BREW, brewAppdir, brewFailure, brewUpgradeScript, CASKROOM, isBrewInstall } from '../src/main/brew'

const EXEC = '/Applications/ClauseDown.app/Contents/MacOS/ClauseDown'
const config = (appdir: string, explicit?: string) => JSON.stringify({ default: { appdir }, explicit: explicit ? { appdir: explicit } : {} })

describe('Homebrew で入れたかの判定', () => {
	it('実行ファイルからアプリの場所を取り出す', () => {
		expect(appBundleOf(EXEC)).toBe('/Applications/ClauseDown.app')
		expect(appBundleOf('/usr/local/bin/node')).toBeNull()
	})

	it('入れ先は指定があればそれを、なければ既定を使う', () => {
		expect(brewAppdir(config('/Applications'))).toBe('/Applications')
		expect(brewAppdir(config('/Applications', '/Users/a/Apps'))).toBe('/Users/a/Apps')
		expect(brewAppdir('{壊れた')).toBeNull()
	})

	it('Caskroom の入れ先と実行中のアプリの場所が同じなら Homebrew とみなす', () => {
		const files: Record<string, string> = { [`${CASKROOM}/.metadata/config.json`]: config('/Applications') }
		const read = (p: string) => {
			if (!(p in files)) throw new Error('ENOENT')
			return files[p]
		}
		const exists = (p: string) => p === BREW
		expect(isBrewInstall(EXEC, read, exists)).toBe(true)
		expect(isBrewInstall('/Users/a/Downloads/ClauseDown.app/Contents/MacOS/ClauseDown', read, exists)).toBe(false)
		expect(isBrewInstall(EXEC, read, () => false)).toBe(false)
		expect(
			isBrewInstall(
				EXEC,
				() => {
					throw new Error('ENOENT')
				},
				exists,
			),
		).toBe(false)
	})
})

describe('Homebrew での更新', () => {
	it('アプリの終了を待ってから brew upgrade を実行し、起動し直す', () => {
		const script = brewUpgradeScript(123, "/Applications/Clause'Down.app", '/tmp/update.log')
		const lines = script.split('\n')
		expect(lines[0]).toContain('kill -0 123')
		expect(script).toContain(`${BREW} upgrade --cask shiozaki-shota/tap/clausedown`)
		expect(script).toContain(`> '/tmp/update.log' 2>&1`)
		expect(lines.at(-1)).toBe(`open '/Applications/Clause'\\''Down.app'`)
	})

	it('ログから失敗の理由を取り出す', () => {
		expect(brewFailure('==> Upgrading clausedown\nexit=0\n')).toBeNull()
		expect(brewFailure("==> Downloading\nError: Download failed on Cask 'clausedown'\nexit=1\n")).toBe("Download failed on Cask 'clausedown'")
		expect(brewFailure('something went wrong\nexit=2')).toBe('something went wrong')
		expect(brewFailure('')).toBeNull()
	})
})
