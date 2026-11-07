export interface CellSpan {
    rowspan: number
    colspan: number
    hidden: boolean
}

interface Owner {
    row: number
    col: number
    left: number
}

export const MERGE_RIGHT = '>'
export const MERGE_UP = '^'

export function tableSpans(grid: string[][], bodyStart = 1): CellSpan[][] {
    const spans: CellSpan[][] = grid.map((r) => r.map(() => ({ rowspan: 1, colspan: 1, hidden: false })))
    const owners: Owner[][] = grid.map(() => [])
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r]
        const counted = new Set<Owner>()
        for (let c = row.length - 1; c >= 0; c--) {
            const text = row[c].trim()
            const self: Owner = { row: r, col: c, left: c }
            owners[r][c] = self
            if (text === MERGE_UP && r > 0 && r !== bodyStart) {
                const o = owners[r - 1][c]
                if (!o) continue
                owners[r][c] = o
                spans[r][c].hidden = true
                if (!counted.has(o)) {
                    counted.add(o)
                    spans[o.row][o.col].rowspan++
                }
                continue
            }
            if (text === MERGE_RIGHT && c < row.length - 1) {
                const o = owners[r][c + 1]
                if (o.row === r) {
                    o.left = c
                    spans[o.row][o.col].colspan++
                } else if (o.left > c) continue
                owners[r][c] = o
                spans[r][c].hidden = true
            }
        }
    }
    return spans
}

export function visibleCells(grid: string[][]): string[][] {
    const spans = tableSpans(grid)
    return grid.map((r, ri) => r.filter((_, ci) => !spans[ri][ci].hidden))
}
