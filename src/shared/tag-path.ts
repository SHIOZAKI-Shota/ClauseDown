// 施行日・納品の印（git のタグ）に文書のパスを入れるときの書き方。
// git の名前に使えない字（空白・~ ^ : ? * [ \ など）を %XX にする。英語の文書名は空白を含むことが多い
// eslint-disable-next-line no-control-regex -- git の名前に使えない制御文字も符号化する
const BAD = /[%\s~^:?*[\\\x00-\x1f\x7f]|\.(?=\.)|@(?=\{)|\.lock(?=\/|$)/g

export function tagPath(docPath: string): string {
    return docPath
        .replace(/\.md$/i, '')
        .replace(BAD, (c) =>
            c === '.lock' ? '%2Elock' : [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
        )
        .split('/')
        .map((part) => (part.startsWith('.') ? `%2E${part.slice(1)}` : part))
        .join('/')
}

export function fromTagPath(part: string): string {
    try {
        return decodeURIComponent(part.replace(/%(?![0-9A-Fa-f]{2})/g, '%25'))
    } catch {
        return part
    }
}
