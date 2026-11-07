import type { DocFile } from '@shared/api'

export interface FolderGroup {
    folder: string
    docs: DocFile[]
}

export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

export const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

export function groupByFolder(docs: DocFile[], query = ''): FolderGroup[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const map = new Map<string, DocFile[]>()
    for (const d of docs) {
        const folder = folderOf(d.path)
        const hay = `${folder} ${d.title} ${d.path}`.toLowerCase()
        if (!words.every((w) => hay.includes(w))) continue
        map.set(folder, [...(map.get(folder) ?? []), d])
    }
    return [...map.entries()]
        .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ja')))
        .map(([folder, docs]) => ({ folder, docs }))
}

export function allFolders(docs: DocFile[]): string[] {
    return [...new Set(docs.map((d) => folderOf(d.path)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'))
}

export interface FolderNode {
    path: string
    name: string
    count: number
    children: FolderNode[]
}

export function folderTree(docs: DocFile[]): FolderNode {
    const root: FolderNode = { path: '', name: '', count: 0, children: [] }
    const index = new Map<string, FolderNode>([['', root]])
    for (const d of docs) {
        const parts = folderOf(d.path).split('/').filter(Boolean)
        root.count++
        let node = root
        let path = ''
        for (const part of parts) {
            path = path ? `${path}/${part}` : part
            let next = index.get(path)
            if (!next) {
                next = { path, name: part, count: 0, children: [] }
                index.set(path, next)
                node.children.push(next)
            }
            next.count++
            node = next
        }
    }
    const sort = (n: FolderNode) => {
        n.children.sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }))
        n.children.forEach(sort)
    }
    sort(root)
    return root
}

export function findFolder(root: FolderNode, path: string): FolderNode | null {
    if (!path) return root
    let node: FolderNode | undefined = root
    let at = ''
    for (const part of path.split('/')) {
        at = at ? `${at}/${part}` : part
        node = node?.children.find((c) => c.path === at)
        if (!node) return null
    }
    return node
}

export const isUnder = (path: string, folder: string) => !folder || path.startsWith(`${folder}/`)
