declare module 'parse5' {
    interface Node {
        tagName?: string
        attrs?: { name: string; value: string }[]
        childNodes?: Node[]
        content?: Node
    }
    export function parseFragment(html: string): Node
}
