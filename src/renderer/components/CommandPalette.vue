<script setup lang="ts">
import { articleTitle, parseLegal } from '@shared/legal-parser'
import { useApp } from '~/stores/app'
import { folderOf } from '~/utils/folders'
import { useTheme } from '~/composables/useTheme'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const theme = useTheme()
const t = useT()

function run(fn: () => void) {
    open.value = false
    fn()
}

interface ArticleHit {
    path: string
    doc: string
    line: number
    label: string
    title: string
    key: string
}
const MAX_ARTICLES = 40
const term = ref('')
const articles = shallowRef<ArticleHit[]>([])
const norm = (v: string) => v.normalize('NFKC').toLowerCase()
let loadSeq = 0
async function loadArticles() {
    const dir = app.repoDir
    if (!dir) return (articles.value = [])
    const seq = ++loadSeq
    const lists = await Promise.all(
        app.docs.map(async (d) => {
            const src = await window.api.readDoc(dir, d.path).catch(() => '')
            const out: ArticleHit[] = []
            const ld = parseLegal(src)
            for (const ch of ld.chapters)
                for (const a of ch.articles)
                    if (!a.deleted && a.line >= 0) {
                        const title = articleTitle(a, ld)
                        out.push({ path: d.path, doc: d.title, line: a.line, label: a.label, title, key: norm(`${a.label} ${title} ${a.title}`) })
                    }
            return out
        }),
    )
    if (seq === loadSeq) articles.value = lists.flat()
}
watch(open, (v) => {
    term.value = ''
    if (v) void loadArticles()
})
const articleItems = computed(() => {
    const words = norm(term.value).split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return articles.value
        .filter((a) => words.every((w) => a.key.includes(w) || norm(a.doc).includes(w)))
        .slice(0, MAX_ARTICLES)
        .map((a) => ({
            label: a.title ? `${a.label}（${a.title}）` : a.label,
            suffix: a.doc,
            icon: 'i-lucide-pilcrow',
            onSelect: () =>
                run(() => {
                    app.jumpTo = { path: a.path, line: a.line }
                    app.openDoc(a.path)
                }),
        }))
})

const groups = computed(() => {
    const m = t.value.shell.palette
    const c = t.value.common
    return [
        {
            id: 'docs',
            label: m.docs,
            items: app.docs.map((d) => ({
                label: d.title,
                suffix: folderOf(d.path),
                icon: 'i-lucide-file-text',
                onSelect: () => run(() => app.openDoc(d.path)),
            })),
        },
        {
            id: 'articles',
            label: m.articles,
            ignoreFilter: true,
            items: articleItems.value,
        },
        {
            id: 'branches',
            label: m.drafts,
            items: app.branches.map((b) => ({
                label: b.label,
                suffix: b.current ? c.working : b.isMain ? m.main : m.unmerged(b.changes),
                icon: b.isMain ? 'i-lucide-book-check' : 'i-lucide-file-pen-line',
                onSelect: () => run(() => !b.current && app.switchBranch(b.name)),
            })),
        },
        {
            id: 'actions',
            label: m.actions,
            items: [
                { label: c.newDoc, icon: 'i-lucide-file-plus', onSelect: () => run(() => (app.dialog = { kind: 'newDoc' })) },
                { label: c.newDraft, icon: 'i-lucide-git-branch-plus', onSelect: () => run(() => (app.dialog = { kind: 'newBranch' })) },
                { label: m.sync, icon: 'i-lucide-refresh-cw', onSelect: () => run(() => app.sync()) },
                { label: m.home, icon: 'i-lucide-house', onSelect: () => run(() => (app.view = 'home')) },
                { label: c.repoHome, icon: 'i-lucide-layout-grid', onSelect: () => run(() => (app.view = 'docs')) },
                { label: c.issues, icon: 'i-lucide-list-todo', onSelect: () => run(() => app.openIssues()) },
                { label: m.newIssue, icon: 'i-lucide-circle-plus', onSelect: () => run(() => app.openIssues({ draft: { title: '', body: '' } })) },
                { label: m.scheduleRepo, icon: 'i-lucide-calendar-range', onSelect: () => run(() => app.openSchedule()) },
                { label: m.scheduleAll, icon: 'i-lucide-calendar-days', onSelect: () => run(() => app.openScheduleAll()) },
                { label: m.addDue, icon: 'i-lucide-calendar-plus', onSelect: () => run(() => (app.dialog = { kind: 'newEvent' })) },
                { label: m.settingsApp, icon: 'i-lucide-settings', onSelect: () => run(() => (app.view = 'setup')) },
                { label: c.repoSettings, icon: 'i-lucide-settings-2', onSelect: () => run(() => (app.view = 'repo')) },
                ...(isDemo() ? [] : [{ label: c.aboutApp, icon: 'i-lucide-info', onSelect: () => run(() => (app.view = 'about')) }]),
                {
                    label: theme.dark.value ? t.value.shell.theme.toLight : t.value.shell.theme.toDark,
                    icon: theme.dark.value ? 'i-lucide-sun' : 'i-lucide-moon',
                    onSelect: () => run(() => theme.toggle()),
                },
            ],
        },
    ]
})
</script>

<template>
    <UModal v-model:open="open" :ui="{ content: 'cd-palette' }">
        <template #content>
            <UCommandPalette
                v-model:search-term="term"
                :groups="groups"
                :placeholder="t.shell.palette.placeholder"
                close
                @update:open="(v: boolean) => !v && (open = false)"
            />
        </template>
    </UModal>
</template>
