import { parseDocument } from '@mdsig/core'

export interface SignatureChain {
    line: number
    count: number
}

const SECTION_MARKER_RE = /^<!--\s*\/?mdsig:section\b[^\n]*-->\s*$/

export const isSectionMarker = (html: string): boolean => SECTION_MARKER_RE.test(html.trim())

export function blankChain(input: string): { text: string; chain?: SignatureChain } {
    if (!input.includes('<!-- md-signature')) return { text: input }
    const { chain } = parseDocument(input)
    if (!chain.length) return { text: input }
    const line = chain[0].line
    const lines = input.split(/\r\n|\r|\n/)
    const text = lines.map((l, i) => (i >= line - 1 ? '' : l)).join('\n')
    return { text, chain: { line, count: chain.length } }
}
