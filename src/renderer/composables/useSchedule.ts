import type { Ref } from 'vue'
import {
    addDays,
    byDate,
    kindMap,
    type DueEvent,
    type DueEventInput,
    type EventKind,
    type Occurrence,
    type RepoSchedule,
} from '@shared/schedule'
import { useApp } from '~/stores/app'
import { todayISO } from '~/utils/format'
import { toPlain } from '~/utils/ipc'

const YEARS = 5

export type RepoOccurrence = Occurrence & { dir: string; repo?: string }

export function useSchedule(all?: Ref<boolean>) {
    const app = useApp()
    const today = todayISO()
    const from = addDays(today, -365 * YEARS)
    const to = addDays(today, 365 * YEARS)
    const repos = shallowRef<RepoSchedule[]>([])
    const items = shallowRef<RepoOccurrence[]>([])
    const loaded = ref(false)
    const isAll = () => !!all?.value

    let seq = 0
    async function load() {
        const n = ++seq
        if (isAll()) {
            const r = await window.api.occurrencesAll(from, to, today).catch(() => null)
            if (!r || n !== seq || !isAll()) return
            repos.value = r.repos
            items.value = r.items
        } else {
            const dir = app.repoDir
            if (!dir) return
            const r = await window.api.occurrences(dir, from, to, today).catch(() => null)
            if (!r || n !== seq || dir !== app.repoDir || isAll()) return
            repos.value = [{ dir, name: app.repo?.name ?? '', kinds: r.kinds, events: r.events, docs: app.docs }]
            items.value = r.items.map((o) => ({ ...o, dir }))
        }
        loaded.value = true
    }

    async function loadRepo(dir: string) {
        const repo = repos.value.find((r) => r.dir === dir)
        if (!repo) return load()
        const n = ++seq
        const r = await window.api.occurrences(dir, from, to, today).catch(() => null)
        if (!r || n !== seq || !isAll()) return
        const kindOf = kindMap(r.kinds)
        repos.value = repos.value.map((x) => (x.dir === dir ? { ...x, kinds: r.kinds, events: r.events } : x))
        const fresh = r.items.map((o) => {
            const k = kindOf(o.kind)
            return { ...o, key: `${dir}|${o.key}`, dir, repo: repo.name, kindLabel: k.label, color: k.color }
        })
        items.value = [...items.value.filter((o) => o.dir !== dir), ...fresh].sort(byDate)
    }

    watch(() => [isAll(), app.repoDir, app.reloadKey], load, { immediate: true })
    watch(
        () => app.scheduleKey,
        () => {
            const dir = app.scheduleDir
            return isAll() && loaded.value && dir ? loadRepo(dir) : load()
        },
    )

    const repoByDir = computed(() => new Map(repos.value.map((r) => [r.dir, r])))
    const repoOf = (dir?: string) => repoByDir.value.get(dir ?? app.repoDir ?? '') ?? repos.value[0]
    const kinds = computed(() => repoOf()?.kinds ?? [])
    const events = computed(() => repoOf()?.events ?? [])
    const maps = computed(() => new Map(repos.value.map((r) => [r.dir, kindMap(r.kinds)])))
    const kindOf = computed(() => (id: string, dir?: string): EventKind => {
        const m = maps.value.get(dir ?? app.repoDir ?? '') ?? maps.value.values().next().value ?? kindMap([])
        return m(id)
    })
    const eventMaps = computed(() => new Map(repos.value.map((r) => [r.dir, new Map(r.events.map((e) => [e.id, e]))])))
    const eventOf = (id: string, dir?: string): DueEvent | undefined => {
        const r = repoOf(dir)
        return r ? eventMaps.value.get(r.dir)?.get(id) : undefined
    }

    const dirOf = (o: { dir?: string }) => o.dir ?? app.repoDir!

    async function toggleDone(o: Occurrence & { dir?: string }) {
        if (o.source !== 'event') return
        const ok = await app.runOk(() => window.api.setEventDone(dirOf(o), o.id, o.date, !o.done))
        if (ok) app.touchSchedule(dirOf(o))
    }

    async function save(input: DueEventInput, dir = app.repoDir!): Promise<boolean> {
        const ok = await app.runOk(() => window.api.saveEvent(dir, toPlain(input)), '期日を保存しました')
        if (ok) app.touchSchedule(dir)
        return ok
    }

    async function remove(id: string, dir = app.repoDir!) {
        const ok = await app.runOk(() => window.api.deleteEvent(dir, id), '期日を消しました')
        if (ok) app.touchSchedule(dir)
    }

    async function move(o: Occurrence & { dir?: string }, date: string) {
        const e = eventOf(o.id, o.dir)
        if (o.source !== 'event' || !e || e.repeat || date === e.date) return
        const span = e.end ? Math.round((Date.parse(e.end) - Date.parse(e.date)) / 86400000) : 0
        const { done: _d, by: _b, at: _a, updatedAt: _u, deleted: _x, ...rest } = e
        await save({ ...rest, date, ...(span ? { end: addDays(date, span) } : {}) }, dirOf(o))
    }

    return { today, repos, repoOf, kinds, events, items, loaded, load, kindOf, eventOf, toggleDone, save, remove, move }
}
