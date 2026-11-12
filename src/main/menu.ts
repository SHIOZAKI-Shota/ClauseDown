import { app, Menu, type MenuItemConstructorOptions } from 'electron'

export function setAppMenu(): void {
    if (process.platform !== 'darwin') return
    const name = app.name
    const dev: MenuItemConstructorOptions[] = app.isPackaged
        ? []
        : [{ type: 'separator' }, { role: 'reload', label: '再読み込み' }, { role: 'toggleDevTools', label: '開発者ツール' }]
    const template: MenuItemConstructorOptions[] = [
        {
            label: name,
            submenu: [
                { role: 'about', label: `${name} について` },
                { type: 'separator' },
                { role: 'services', label: 'サービス' },
                { type: 'separator' },
                { role: 'hide', label: `${name} を隠す` },
                { role: 'hideOthers', label: 'ほかを隠す' },
                { role: 'unhide', label: 'すべてを表示' },
                { type: 'separator' },
                { role: 'quit', label: `${name} を終了` },
            ],
        },
        {
            label: '編集',
            submenu: [
                { role: 'undo', label: '取り消す' },
                { role: 'redo', label: 'やり直す' },
                { type: 'separator' },
                { role: 'cut', label: 'カット' },
                { role: 'copy', label: 'コピー' },
                { role: 'paste', label: 'ペースト' },
                { role: 'selectAll', label: 'すべてを選択' },
            ],
        },
        {
            label: '表示',
            submenu: [{ role: 'togglefullscreen', label: 'フルスクリーンにする／解除する' }, ...dev],
        },
        {
            role: 'window',
            label: 'ウインドウ',
            submenu: [{ role: 'minimize', label: 'しまう' }, { role: 'zoom', label: '拡大／縮小' }, { type: 'separator' }, { role: 'close', label: '閉じる' }],
        },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
