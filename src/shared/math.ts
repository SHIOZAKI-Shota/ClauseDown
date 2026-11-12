import temml from 'temml'
import { TEMML_CSS } from './temml-css'
import type { MarkdownIt as Md } from 'markdown-it'

export interface MathSpan {
    from: number
    to: number
    tex: string
    display: boolean
}

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/

export function scanMath(src: string, pos: number): MathSpan | null {
    if (src[pos] !== '$' || src[pos - 1] === '\\') return null
    const display = src[pos + 1] === '$'
    const open = display ? 2 : 1
    const start = pos + open
    if (!display && (!src[start] || /\s/.test(src[start]))) return null
    let end = start
    for (;;) {
        end = src.indexOf(display ? '$$' : '$', end)
        if (end < 0) return null
        if (src[end - 1] === '\\') {
            end++
            continue
        }
        if (!display && (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? ''))) {
            end++
            continue
        }
        break
    }
    const tex = src.slice(start, end)
    if (!tex.trim() || JAPANESE.test(tex.replace(/\\text\{[^{}]*\}/g, ''))) return null
    return { from: pos, to: end + open, tex, display }
}

export function findMath(src: string): MathSpan[] {
    const out: MathSpan[] = []
    for (let i = src.indexOf('$'); i >= 0;) {
        const m = scanMath(src, i)
        if (m) {
            out.push(m)
            i = src.indexOf('$', m.to)
        } else i = src.indexOf('$', i + (src[i + 1] === '$' ? 2 : 1))
    }
    return out
}

const OPTIONS = { trust: false, strict: false }

export const MATH_CSS =
    TEMML_CSS +
    '\nmath { font-family: "STIX Two Math", "Cambria Math", math; }\nmtd { padding-top: 0.3em; padding-bottom: 0.3em; }\n.cd-math-display { display: block; margin: 0.4em 0; text-indent: 0; }\n'

export function renderMath(tex: string, display: boolean): string {
    const html = temml.renderToString(tex, { ...OPTIONS, displayMode: display, throwOnError: false })
    return display ? `<span class="cd-math-display">${html}</span>` : `<span class="cd-math">${html}</span>`
}

export function mathError(tex: string, display = false): string | null {
    try {
        temml.renderToString(tex, { ...OPTIONS, displayMode: display, throwOnError: true })
        return null
    } catch (e) {
        return (e as Error).message.replace(/^Temml parse error:\s*/i, '').replace(/^ParseError:\s*/i, '')
    }
}

export const mathKey = (tex: string) => `math:${tex.trim()}`

export function displayLine(line: string): string | null {
    const m = /^\s*\$\$([\s\S]+?)\$\$\s*$/.exec(line)
    return m && m[1].trim() ? m[1] : null
}

export function useMath(md: Md): Md {
    md.inline.ruler.before('escape', 'cd_math', (state, silent) => {
        const m = scanMath(state.src, state.pos)
        if (!m) return false
        if (!silent) {
            const t = state.push('math_inline', 'math', 0)
            t.content = m.tex
            t.info = m.display ? 'display' : ''
        }
        state.pos = m.to
        return true
    })
    md.renderer.rules.math_inline = (tokens, idx) => renderMath(tokens[idx].content, tokens[idx].info === 'display')
    return md
}
