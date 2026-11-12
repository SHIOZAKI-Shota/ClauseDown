const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function toKanji(n: number): string {
    if (!Number.isInteger(n) || n < 0) return String(n)
    if (n === 0) return '〇'
    if (n >= 10000) return String(n)
    const units: [number, string][] = [
        [1000, '千'],
        [100, '百'],
        [10, '十'],
    ]
    let out = ''
    let rest = n
    for (const [value, mark] of units) {
        const d = Math.floor(rest / value)
        if (d > 0) out += (d === 1 ? '' : KANJI_DIGITS[d]) + mark
        rest %= value
    }
    return out + KANJI_DIGITS[rest]
}

export function toFullwidth(n: number | string): string {
    return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0))
}

export function toCircled(n: number): string {
    if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1)
    if (n >= 21 && n <= 35) return String.fromCharCode(0x3251 + n - 21)
    if (n >= 36 && n <= 50) return String.fromCharCode(0x32b1 + n - 36)
    return `（${n}）`
}

const IROHA = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセス'

export function toIroha(n: number): string {
    if (n < 1) return String(n)
    const len = IROHA.length
    let out = ''
    let rest = n
    while (rest > 0) {
        out = IROHA[(rest - 1) % len] + out
        rest = Math.floor((rest - 1) / len)
    }
    return out
}

export function toRoman(n: number): string {
    if (n < 1 || n >= 4000) return String(n)
    const table: [number, string][] = [
        [1000, 'm'],
        [900, 'cm'],
        [500, 'd'],
        [400, 'cd'],
        [100, 'c'],
        [90, 'xc'],
        [50, 'l'],
        [40, 'xl'],
        [10, 'x'],
        [9, 'ix'],
        [5, 'v'],
        [4, 'iv'],
        [1, 'i'],
    ]
    let out = ''
    let rest = n
    for (const [value, sym] of table) {
        while (rest >= value) {
            out += sym
            rest -= value
        }
    }
    return out
}

export type NumeralStyle = 'kanji' | 'arabic' | 'fullwidth' | 'circled' | 'iroha' | 'roman' | 'paren'

export function formatNumber(n: number, style: NumeralStyle): string {
    switch (style) {
        case 'kanji':
            return toKanji(n)
        case 'arabic':
            return String(n)
        case 'fullwidth':
            return toFullwidth(n)
        case 'circled':
            return toCircled(n)
        case 'iroha':
            return toIroha(n)
        case 'roman':
            return `（${toRoman(n)}）`
        case 'paren':
            return `（${n}）`
    }
}
