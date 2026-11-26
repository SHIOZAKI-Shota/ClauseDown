import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { t } from '../shared/i18n'

export function setAppMenu(): void {
	if (process.platform !== 'darwin') return
	const name = app.name
	const m = t().menu
	const dev: MenuItemConstructorOptions[] = app.isPackaged
		? []
		: [{ type: 'separator' }, { role: 'reload', label: m.reload }, { role: 'toggleDevTools', label: m.devTools }]
	const template: MenuItemConstructorOptions[] = [
		{
			label: name,
			submenu: [
				{ role: 'about', label: m.about(name) },
				{ type: 'separator' },
				{ role: 'services', label: m.services },
				{ type: 'separator' },
				{ role: 'hide', label: m.hide(name) },
				{ role: 'hideOthers', label: m.hideOthers },
				{ role: 'unhide', label: m.unhide },
				{ type: 'separator' },
				{ role: 'quit', label: m.quit(name) },
			],
		},
		{
			label: m.edit,
			submenu: [
				{ role: 'undo', label: m.undo },
				{ role: 'redo', label: m.redo },
				{ type: 'separator' },
				{ role: 'cut', label: m.cut },
				{ role: 'copy', label: m.copy },
				{ role: 'paste', label: m.paste },
				{ role: 'selectAll', label: m.selectAll },
			],
		},
		{
			label: m.view,
			submenu: [{ role: 'togglefullscreen', label: m.fullscreen }, ...dev],
		},
		{
			role: 'window',
			label: m.window,
			submenu: [{ role: 'minimize', label: m.minimize }, { role: 'zoom', label: m.zoom }, { type: 'separator' }, { role: 'close', label: m.close }],
		},
	]
	Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
