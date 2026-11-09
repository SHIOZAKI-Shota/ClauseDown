import { imagePathOf, rewriteImages } from '@shared/images'

export const repoImageUrl = (dir: string, path: string): string =>
    `app://bundle/__repo/${encodeURIComponent(dir)}/${path.split('/').map(encodeURIComponent).join('/')}`

export function withImages(html: string, dir: string | null | undefined, docPath: string | null | undefined): string {
    if (!dir || !docPath || !html.includes('<img')) return html
    return rewriteImages(html, (src) => {
        const path = imagePathOf(docPath, src)
        return path ? repoImageUrl(dir, path) : null
    })
}
