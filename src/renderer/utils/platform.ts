export const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

/** Ctrl にあたるキーの名前。「Ctrl＋ホイール」のように、キー以外と組み合わせて書くときに使う */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

const MAC_MODS: [string, string][] = [
    ['Alt', '⌥'],
    ['Shift', '⇧'],
    ['Ctrl', '⌘'],
]

/** ショートカットの表記。'Ctrl+Alt+A' のように Windows の書き方で渡すと、macOS では '⌥⌘A' に直す */
export function keys(combo: string): string {
    if (!IS_MAC) return combo
    const parts = combo.split('+')
    const mods = MAC_MODS.filter(([name]) => parts.includes(name)).map(([, sign]) => sign)
    const rest = parts.filter((p) => !MAC_MODS.some(([name]) => name === p))
    return mods.join('') + rest.join('')
}

/** やり直しは、Windows が Ctrl+Y、macOS が ⇧⌘Z */
export const REDO_KEYS = IS_MAC ? keys('Ctrl+Shift+Z') : 'Ctrl+Y'
