export type SealStyle = 'kanji' | 'latin'

export interface SealInput {
    text: string
    style: SealStyle
    color?: string
    sub?: string
}

export const SEAL_COLOR = '#d7261e'
export const SIGN_INK = '#1f2937'
export const SEAL_SIZE = 200
const MINCHO = `'Hiragino Mincho ProN','Yu Mincho','YuMincho','MS Mincho','Noto Serif JP',serif`
const SERIF = `'Times New Roman','Georgia',serif`

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export class SealError extends Error {}

const graphemes = (s: string) => Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(s), (g) => g.segment)

interface Glyph {
    ch: string
    x: number
    y: number
    size: number
}

export function kanjiLayout(text: string): Glyph[] {
    const chars = graphemes(text.replace(/\s+/g, ''))
    if (!chars.length || chars.length > 4) throw new SealError(String(chars.length))
    const c = SEAL_SIZE / 2
    switch (chars.length) {
        case 1:
            return [{ ch: chars[0], x: c, y: c, size: 118 }]
        case 2:
            return chars.map((ch, i) => ({ ch, x: c, y: c + (i ? 36 : -36), size: 70 }))
        case 3:
            return chars.map((ch, i) => ({ ch, x: c, y: c + (i - 1) * 50, size: 50 }))
        default:
            return chars.map((ch, i) => ({ ch, x: i < 2 ? c + 36 : c - 36, y: c + (i % 2 ? 36 : -36), size: 64 }))
    }
}

export function sealSvg(input: SealInput): string {
    const color = /^#[0-9a-f]{6}$/i.test(input.color ?? '') ? input.color! : SEAL_COLOR
    const c = SEAL_SIZE / 2
    const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SEAL_SIZE} ${SEAL_SIZE}" width="${SEAL_SIZE * 3}" height="${SEAL_SIZE * 3}">`
    if (input.style === 'kanji') {
        const glyphs = kanjiLayout(input.text)
        const text = glyphs
            .map((g) => `<text x="${g.x}" y="${g.y}" font-size="${g.size}" text-anchor="middle" dominant-baseline="central">${esc(g.ch)}</text>`)
            .join('')
        return `${open}<g fill="none" stroke="${color}"><circle cx="${c}" cy="${c}" r="92" stroke-width="8"/></g><g fill="${color}" font-family="${MINCHO}" font-weight="700">${text}</g></svg>`
    }
    const name = input.text.trim().replace(/\s+/g, ' ')
    if (!name) throw new SealError('0')
    if (name.length > 28) throw new SealError(String(name.length))
    const initials =
        name
            .split(' ')
            .filter(Boolean)
            .map((w) => graphemes(w)[0])
            .slice(0, 3)
            .join('')
            .toUpperCase() || graphemes(name)[0]
    const sub = (input.sub ?? '').trim().slice(0, 28)
    const top = `M ${c - 75},${c} A 75,75 0 0 1 ${c + 75},${c}`
    const bottom = `M ${c - 75},${c} A 75,75 0 0 0 ${c + 75},${c}`
    const fit = (s: string) => Math.max(11, Math.min(20, Math.floor(230 / Math.max(1, s.length))))
    return (
        `${open}<defs><path id="t" d="${top}"/><path id="b" d="${bottom}"/></defs>` +
        `<g fill="none" stroke="${color}"><circle cx="${c}" cy="${c}" r="94" stroke-width="5"/><circle cx="${c}" cy="${c}" r="58" stroke-width="3"/></g>` +
        `<g fill="${color}" font-family="${SERIF}" font-weight="700" letter-spacing="1">` +
        `<text font-size="${fit(name)}" text-anchor="middle"><textPath href="#t" startOffset="50%" dominant-baseline="central">${esc(name.toUpperCase())}</textPath></text>` +
        (sub
            ? `<text font-size="${fit(sub)}" text-anchor="middle"><textPath href="#b" startOffset="50%" dominant-baseline="central">${esc(sub.toUpperCase())}</textPath></text>`
            : '') +
        `<text x="${c}" y="${c}" font-size="${initials.length > 2 ? 34 : 44}" text-anchor="middle" dominant-baseline="central">${esc(initials)}</text></g></svg>`
    )
}
