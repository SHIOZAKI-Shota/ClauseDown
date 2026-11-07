export interface GraphNode {
    oid: string
    parents: string[]
    onMain?: boolean
}

export interface GraphEdge {
    fromRow: number
    fromLane: number
    toRow: number
    toLane: number
    curve: 'top' | 'bottom'
}

export interface GraphLayout {
    lanes: number[]
    edges: GraphEdge[]
    width: number
}

export function layoutGraph(nodes: GraphNode[]): GraphLayout {
    const pinMain = nodes.some((n) => n.onMain)
    const first = pinMain ? 1 : 0
    const row = new Map(nodes.map((n, i) => [n.oid, i]))
    const active: (string | null)[] = []
    const lanes: number[] = []
    const pending: { from: number; fromLane: number; oid: string; curve: 'top' | 'bottom'; lane: number }[] = []
    let width = 0

    const freeLane = () => {
        for (let i = first; i < active.length; i++) if (active[i] === null || active[i] === undefined) return i
        return Math.max(active.length, first)
    }

    nodes.forEach((n, r) => {
        let lane = n.onMain ? 0 : active.indexOf(n.oid)
        if (!n.onMain && (lane === -1 || (pinMain && lane === 0))) lane = freeLane()
        active.forEach((oid, i) => {
            if (oid === n.oid && i !== lane) active[i] = null
        })
        active[lane] = null
        lanes[r] = lane

        n.parents.forEach((p, idx) => {
            if (!row.has(p)) return
            if (idx === 0) {
                if (!(pinMain && lane !== 0 && nodes[row.get(p)!]?.onMain)) active[lane] = p
                pending.push({ from: r, fromLane: lane, oid: p, curve: 'bottom', lane })
            } else {
                let target = active.indexOf(p)
                if (target === -1) {
                    target = freeLane()
                    active[target] = p
                }
                pending.push({ from: r, fromLane: lane, oid: p, curve: 'top', lane: target })
            }
        })
        width = Math.max(width, active.length, lane + 1)
        if (pinMain && active[0] === undefined) active[0] = null
    })

    const edges = pending.map((e) => {
        const toRow = row.get(e.oid)!
        return { fromRow: e.from, fromLane: e.fromLane, toRow, toLane: lanes[toRow], curve: e.curve }
    })
    return { lanes, edges, width: Math.max(width, 1) }
}
