import { fontNames } from './fonts'

export interface CdProps {
    fontSize?: string
    fontFamily?: string
    textAlign?: 'left' | 'center' | 'right'
    lineHeight?: string
    cols?: string[]
    break?: boolean
}

const ATTR_RE = /\.?([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'{}]+)))?/g
const OPEN_RE = /^\s*:{3,}\s*(?:\{([^{}]*)\}|([\w.-]+(?:[ \t]+[\w.=,%-]+)*))\s*:*\s*$/
const CLOSE_RE = /^\s*:{3,}\s*$/
const ATTR_LINE_RE = /^\s*\{([^{}]*)\}\s*$/
const INLINE_RE = /\[([^[\]]*)\]\{([^{}]*)\}/g
const INLINE_HTML_RE = /\[([^[\]]*)\]\{([^{}<>]*)\}/g

const SIZE_RE = /^\d+(?:\.\d+)?(?:pt|px|mm|em|%)?$/
const COL_RE = /^\d+(?:\.\d+)?(?:%|mm|em|pt)?$/

function size(v: string): string | undefined {
    const s = v.trim()
    if (!SIZE_RE.test(s)) return undefined
    return /\d$/.test(s) ? `${s}pt` : s
}

export function parseProps(attrs: string): CdProps {
    const out: CdProps = {}
    for (const m of attrs.matchAll(ATTR_RE)) {
        const key = m[1].toLowerCase()
        const raw = m[2] ?? m[3] ?? m[4]
        const value = raw?.trim() ?? ''
        switch (key) {
            case 'font-size':
            case 'size': {
                const v = size(value)
                if (v) out.fontSize = v
                break
            }
            case 'font-family':
            case 'font': {
                const v = value.replace(/[;{}<>"'\\]/g, '').trim()
                if (v) out.fontFamily = v
                break
            }
            case 'text-align':
            case 'align':
                if (value === 'left' || value === 'center' || value === 'right') out.textAlign = value
                break
            case 'right':
            case 'center':
            case 'left':
                if (raw === undefined) out.textAlign = key
                break
            case 'line':
            case 'line-height': {
                const n = Number(value)
                if (Number.isFinite(n) && n >= 0.8 && n <= 4) out.lineHeight = String(n)
                break
            }
            case 'cols':
            case 'col-widths': {
                const cols = value.split(/[,\s]+/).filter(Boolean)
                if (cols.length && cols.every((c) => COL_RE.test(c))) out.cols = cols.map((c) => (/\d$/.test(c) ? `${c}%` : c))
                break
            }
            case 'break':
            case 'page-break':
                if (raw === undefined || value === 'true' || value === 'page') out.break = true
                break
        }
    }
    return out
}

export const hasProps = (p: CdProps | undefined): p is CdProps => !!p && Object.keys(p).length > 0

export function mergeProps(...list: (CdProps | undefined)[]): CdProps | undefined {
    const out: CdProps = {}
    for (const p of list) if (p) Object.assign(out, p)
    return hasProps(out) ? out : undefined
}

export interface ExtractedProps {
    source: string
    at: (CdProps | undefined)[]
}

export function extractProps(source: string): ExtractedProps {
    if (!source.includes(':::') && !/^\s*\{[^{}]*\}\s*$/m.test(source)) return { source, at: [] }
    const lines = source.split(/\r?\n/)
    const at: (CdProps | undefined)[] = []
    const stack: CdProps[] = []
    let pending: CdProps | undefined
    let breakNext = false
    let fence = ''
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const f = /^\s*(`{3,}|~{3,})/.exec(line)
        if (fence) {
            if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''
            continue
        }
        if (f) fence = f[1]
        if (CLOSE_RE.test(line)) {
            stack.pop()
            lines[i] = ''
            continue
        }
        const open = OPEN_RE.exec(line)
        if (open) {
            const p = parseProps(open[1] ?? open[2] ?? '')
            if (p.break) breakNext = true
            const rest = { ...p }
            delete rest.break
            stack.push(rest)
            lines[i] = ''
            continue
        }
        const single = ATTR_LINE_RE.exec(line)
        if (single) {
            pending = mergeProps(pending, parseProps(single[1]))
            lines[i] = ''
            continue
        }
        if (!line.trim()) continue
        const p = mergeProps(...stack, pending, breakNext ? { break: true } : undefined)
        if (p) at[i] = p
        pending = undefined
        breakNext = false
    }
    const eol = source.includes('\r\n') ? '\r\n' : '\n'
    return { source: lines.join(eol), at }
}

export function propsStyle(p: CdProps | undefined): string {
    if (!p) return ''
    const out: string[] = []
    if (p.fontSize) out.push(`font-size:${p.fontSize}`)
    if (p.fontFamily)
        out.push(
            `font-family:${fontNames(p.fontFamily)
                .map((n) => `'${n}'`)
                .join(',')}`,
        )
    if (p.textAlign) out.push(`text-align:${p.textAlign}`)
    if (p.lineHeight) out.push(`line-height:${p.lineHeight}`)
    if (p.break) out.push('break-before:page')
    return out.join(';')
}

export function propsAttrs(p: CdProps | undefined, cls = ''): string {
    const classes = [cls, p?.break ? 'cd-break' : ''].filter(Boolean).join(' ')
    const style = propsStyle(p)
    return `${classes ? ` class="${classes}"` : ''}${style ? ` style="${style.replace(/"/g, '&quot;')}"` : ''}`
}

export function withCols(html: string, p: CdProps | undefined): string {
    if (!p?.cols?.length) return html
    const group = `<colgroup>${p.cols.map((c) => `<col style="width:${c}">`).join('')}</colgroup>`
    return html.replace(/<table>/, `<table class="cd-fixed" style="table-layout:fixed;width:100%">${group}`)
}

export function stripInlineProps(text: string): string {
    return text.includes(']{') ? text.replace(INLINE_RE, (whole, body: string, attrs: string) => (hasProps(parseProps(attrs)) ? body : whole)) : text
}

export function inlinePropsHtml(html: string): string {
    if (!html.includes(']{')) return html
    return html.replace(INLINE_HTML_RE, (whole, body: string, attrs: string) => {
        const p = parseProps(attrs.replace(/&quot;/g, '"').replace(/&#39;/g, "'"))
        if (!hasProps(p)) return whole
        const style = propsStyle(p)
        return style ? `<span style="${style.replace(/"/g, '&quot;')}">${body}</span>` : body
    })
}

export interface InlineRun {
    text: string
    props?: CdProps
}

export function inlineRuns(text: string): InlineRun[] {
    if (!text.includes(']{')) return [{ text }]
    const out: InlineRun[] = []
    let last = 0
    for (const m of text.matchAll(INLINE_RE)) {
        if (m.index! > last) out.push({ text: text.slice(last, m.index) })
        out.push({ text: m[1], props: parseProps(m[2]) })
        last = m.index! + m[0].length
    }
    if (last < text.length) out.push({ text: text.slice(last) })
    return out
}
