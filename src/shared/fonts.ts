const SAME_FONTS: string[][] = [
    ['游明朝', '游明朝体', 'Yu Mincho', 'YuMincho'],
    ['游ゴシック', '游ゴシック体', 'Yu Gothic', 'YuGothic'],
    ['BIZ UDゴシック', 'BIZ UDGothic'],
    ['BIZ UD明朝 Medium', 'BIZ UDMincho', 'BIZ UDMincho Medium'],
    ['ヒラギノ明朝 ProN', 'Hiragino Mincho ProN'],
    ['ヒラギノ角ゴシック', 'Hiragino Sans'],
]

const groups = new Map(SAME_FONTS.flatMap((g) => g.map((n) => [n.toLowerCase(), g] as const)))

export const canonicalFont = (name: string): string => groups.get(name.toLowerCase())?.[0] ?? name

export function fontNames(name: string): string[] {
    const g = groups.get(name.toLowerCase())
    return g ? [name, ...g.filter((n) => n !== name)] : [name]
}
