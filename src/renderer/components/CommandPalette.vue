<script setup lang="ts">
import { articleTitle, parseLegal } from '@shared/legal-parser'
import { useApp } from '~/stores/app'
import { folderOf } from '~/utils/folders'
import { useTheme } from '~/composables/useTheme'

const open = defineModel<boolean>('open', { required: true })
const app = useApp()
const theme = useTheme()

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

const groups = computed(() => [
    {
        id: 'docs',
        label: '文書',
        items: app.docs.map((d) => ({
            label: d.title,
            suffix: folderOf(d.path),
            icon: 'i-lucide-file-text',
            onSelect: () => run(() => app.openDoc(d.path)),
        })),
    },
    {
        id: 'articles',
        label: '条',
        ignoreFilter: true,
        items: articleItems.value,
    },
    {
        id: 'branches',
        label: '改定案',
        items: app.branches.map((b) => ({
            label: b.label,
            suffix: b.current ? '作業中' : b.isMain ? '正式な最新の版' : `未反映 ${b.changes} 版`,
            icon: b.isMain ? 'i-lucide-book-check' : 'i-lucide-file-pen-line',
            onSelect: () => run(() => !b.current && app.switchBranch(b.name)),
        })),
    },
    {
        id: 'actions',
        label: '操作',
        items: [
            { label: '新しい文書', icon: 'i-lucide-file-plus', onSelect: () => run(() => (app.dialog = { kind: 'newDoc' })) },
            { label: '新しい改定案', icon: 'i-lucide-git-branch-plus', onSelect: () => run(() => (app.dialog = { kind: 'newBranch' })) },
            { label: '同期', icon: 'i-lucide-refresh-cw', onSelect: () => run(() => app.sync()) },
            { label: '初期ページ', icon: 'i-lucide-house', onSelect: () => run(() => (app.view = 'home')) },
            { label: 'リポジトリホーム', icon: 'i-lucide-layout-grid', onSelect: () => run(() => (app.view = 'docs')) },
            { label: '課題', icon: 'i-lucide-list-todo', onSelect: () => run(() => app.openIssues()) },
            { label: '新しい課題…', icon: 'i-lucide-circle-plus', onSelect: () => run(() => app.openIssues({ draft: { title: '', body: '' } })) },
            { label: '期日・有効期間（このリポジトリ）', icon: 'i-lucide-calendar-range', onSelect: () => run(() => app.openSchedule()) },
            { label: 'すべてのリポジトリの期日・有効期間', icon: 'i-lucide-calendar-days', onSelect: () => run(() => app.openScheduleAll()) },
            { label: '期日の追加…', icon: 'i-lucide-calendar-plus', onSelect: () => run(() => (app.dialog = { kind: 'newEvent' })) },
            { label: '設定（アプリ全体）', icon: 'i-lucide-settings', onSelect: () => run(() => (app.view = 'setup')) },
            { label: 'このリポジトリの設定', icon: 'i-lucide-settings-2', onSelect: () => run(() => (app.view = 'repo')) },
            { label: 'このソフトについて', icon: 'i-lucide-info', onSelect: () => run(() => (app.view = 'about')) },
            {
                label: theme.dark.value ? 'ライトモードにする' : 'ダークモードにする',
                icon: theme.dark.value ? 'i-lucide-sun' : 'i-lucide-moon',
                onSelect: () => run(() => theme.toggle()),
            },
        ],
    },
])
</script>

<template>
    <UModal v-model:open="open" :ui="{ content: 'cd-palette' }">
        <template #content>
            <UCommandPalette
                v-model:search-term="term"
                :groups="groups"
                placeholder="文書・条の見出し・改定案・操作を検索…"
                close
                @update:open="(v: boolean) => !v && (open = false)"
            />
        </template>
    </UModal>
</template>
