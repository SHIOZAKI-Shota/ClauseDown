import type { Ref } from 'vue'
import type { CommitInfo, EffectiveVersion } from '@shared/api'
import type { LegalDoc } from '@shared/legal-parser'
import { stepUnits, trailsFor, type HistEvent, type TracedUnit } from '@shared/article-history'
import { useApp } from '~/stores/app'
import { fmtWareki } from '~/utils/format'

export const TRAIL_KIND: Record<HistEvent['kind'], string> = { enacted: '制定', added: '新設', changed: '改正' }

async function readAll<T extends { oid: string }>(dir: string, path: string, list: T[]) {
    const sources = await Promise.all(list.map((v) => window.api.readAt(dir, v.oid, path).catch(() => null)))
    const kept = list.filter((_, i) => sources[i] !== null)
    return { kept, traced: kept.length ? stepUnits(sources.filter((s): s is string => s !== null)) : null }
}

export function useArticleTrail(path: string, doc: Ref<LegalDoc>, cursorLine: Ref<number>) {
    const app = useApp()
    const versions = shallowRef<EffectiveVersion[]>([])
    const traced = shallowRef<TracedUnit[] | null>(null)
    let seq = 0
    async function loadEffective() {
        const dir = app.repoDir
        if (!dir) return
        const n = ++seq
        const list = (await window.api.listEffective(dir, path).catch(() => [] as EffectiveVersion[])).slice().reverse()
        const r = await readAll(dir, path, list)
        if (n !== seq) return
        versions.value = r.kept
        traced.value = r.traced
        commitsLoaded = false
        commits.value = []
        commitTraced.value = null
    }
    onMounted(loadEffective)
    watch(() => app.scheduleKey, loadEffective)

    const article = computed(() => {
        let hit: { line: number; label: string } | null = null
        for (const ch of doc.value.chapters)
            for (const a of ch.articles) if (a.line >= 0 && a.line <= cursorLine.value) hit = { line: a.line, label: a.refLabel }
        return hit
    })
    const articleLine = computed(() => article.value?.line ?? -1)
    const trails = computed(() => trailsFor(traced.value, doc.value))
    const trail = computed(() => trails.value.get(articleLine.value) ?? null)
    const summary = computed(() => {
        const t = trail.value
        if (!t) return ''
        const e = t.events.at(-1)
        if (!e) return '未施行'
        const head = `${fmtWareki(versions.value[e.step]?.date ?? '')}施行で${TRAIL_KIND[e.kind]}`
        return t.pending ? `${head}・未施行の変更あり` : head
    })

    const commits = shallowRef<CommitInfo[]>([])
    const commitTraced = shallowRef<TracedUnit[] | null>(null)
    const commitsLoading = ref(false)
    let commitsLoaded = false
    async function loadCommits() {
        const dir = app.repoDir
        if (!dir || commitsLoaded || commitsLoading.value) return
        commitsLoading.value = true
        try {
            const list = (await window.api.log(dir, path).catch(() => [] as CommitInfo[])).slice().reverse()
            const r = await readAll(dir, path, list)
            commits.value = r.kept
            commitTraced.value = r.traced
            commitsLoaded = true
        } finally {
            commitsLoading.value = false
        }
    }
    watch(
        () => app.currentBranch?.oid,
        () => {
            commitsLoaded = false
            commitTraced.value = null
        },
    )
    const commitTrail = computed(() => (commitTraced.value ? (trailsFor(commitTraced.value, doc.value).get(articleLine.value) ?? null) : null))

    return { versions, article, trail, summary, commits, commitTrail, commitsLoading, loadCommits }
}
