export interface MarkSpot {
    page: number
    y: number
}

export interface LineSpan {
    line: number
    start: MarkSpot
    end: MarkSpot
}

export const MARK_RE = /~cd([se])(\d+)~/g

export const MARK_CSS =
    '[data-line]{position:relative}.cd-mk{position:absolute;left:0;font:1px/1px sans-serif;color:#fff;text-indent:0;letter-spacing:0;white-space:nowrap}'

const OPEN_RE = /<[a-z][\w-]*\b[^>]*\sdata-line="(\d+)"[^>]*>/g

export function withLineMarks(html: string): string {
    return `<style>${MARK_CSS}</style>${html.replace(
        OPEN_RE,
        (tag, n) => `${tag}<span class="cd-mk" style="top:0">~cds${n}~</span><span class="cd-mk" style="bottom:0">~cde${n}~</span>`,
    )}`
}

export function stripMarks(s: string): string {
    return s.replace(MARK_RE, '')
}

export function lineSpans(pages: { str: string; y: number }[][]): LineSpan[] {
    const starts = new Map<number, MarkSpot>()
    const ends = new Map<number, MarkSpot>()
    pages.forEach((items, page) => {
        for (const it of items)
            for (const m of it.str.matchAll(MARK_RE)) {
                const line = Number(m[2])
                if (m[1] === 'e') ends.set(line, { page, y: it.y })
                else if (!starts.has(line)) starts.set(line, { page, y: it.y })
            }
    })
    return [...starts].map(([line, start]) => ({ line, start, end: ends.get(line) ?? start })).sort((a, b) => a.line - b.line)
}
