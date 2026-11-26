import { app } from 'electron'
import { locale, resolveLocale, setLocale } from '../shared/i18n'
import type { AppSettings } from '../shared/api'
import { setAppMenu } from './menu'

export const systemLanguages = (): string[] => app.getPreferredSystemLanguages()

// 設定の言語を反映する。変わったらメニューを作り直す
export function applyLocale(settings: Pick<AppSettings, 'prefs'>): void {
	const before = locale()
	setLocale(resolveLocale(settings.prefs?.language, systemLanguages()))
	if (locale() !== before) setAppMenu()
}
