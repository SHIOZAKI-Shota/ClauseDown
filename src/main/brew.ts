import fs from 'node:fs'
import { t } from '../shared/i18n'
import path from 'node:path'

export const BREW = '/opt/homebrew/bin/brew'
export const CASKROOM = '/opt/homebrew/Caskroom/clausedown'
export const CASK = 'shiozaki-shota/tap/clausedown'
export const BREW_UPGRADE = `brew upgrade --cask ${CASK}`

export function appBundleOf(execPath: string): string | null {
	const m = execPath.match(/^(.+?\.app)\/Contents\/MacOS\//)
	return m ? m[1] : null
}

export function brewAppdir(configJson: string): string | null {
	try {
		const c = JSON.parse(configJson) as { explicit?: { appdir?: string }; default?: { appdir?: string } }
		return c.explicit?.appdir ?? c.default?.appdir ?? null
	} catch {
		return null
	}
}

export function isBrewInstall(
	execPath: string,
	read: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
	exists: (p: string) => boolean = fs.existsSync,
): boolean {
	const bundle = appBundleOf(execPath)
	if (!bundle || !exists(BREW)) return false
	let config: string
	try {
		config = read(path.join(CASKROOM, '.metadata', 'config.json'))
	} catch {
		return false
	}
	const dir = brewAppdir(config)
	return !!dir && path.resolve(dir, 'ClauseDown.app') === path.resolve(bundle)
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export function brewUpgradeScript(pid: number, bundle: string, log: string, cask = CASK): string {
	return [
		`while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
		`osascript -e 'display notification "${t().notify.brewUpdating}" with title "ClauseDown"' >/dev/null 2>&1`,
		`{ ${BREW} upgrade --cask ${cask}; echo "exit=$?"; } > ${quote(log)} 2>&1`,
		`open ${quote(bundle)}`,
	].join('\n')
}

export function brewFailure(log: string): string | null {
	const m = log.match(/exit=(\d+)\s*$/)
	if (!m || m[1] === '0') return null
	const lines = log
		.slice(0, m.index)
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean)
	return lines.find((l) => l.startsWith('Error:'))?.replace(/^Error:\s*/, '') ?? lines.at(-1) ?? t().errors.updater.exitCode(m[1])
}
