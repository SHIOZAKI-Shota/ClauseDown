import { createHash } from 'node:crypto'

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const DATA_BLOCK_RE = /\btype\s*=\s*["']?(application\/json|application\/ld\+json|text\/plain)\b/i

export function inlineScriptHashes(html: string): string[] {
    const out: string[] = []
    for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
        const [, attrs, body] = m
        if (/\bsrc\s*=/i.test(attrs) || DATA_BLOCK_RE.test(attrs) || !body) continue
        out.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
    }
    return [...new Set(out)]
}

export function cspFor(html: string): string {
    return [
        "default-src 'self'",
        `script-src ${["'self'", ...inlineScriptHashes(html)].join(' ')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "frame-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ].join('; ')
}
