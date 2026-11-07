<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { useApp } from '~/stores/app'

const app = useApp()
const md = new MarkdownIt({ html: false, linkify: false, breaks: true })
const text = ref('')
const draft = ref('')
const editing = ref(false)
const loaded = ref(false)
const expanded = ref(false)
const body = ref<HTMLElement>()
const long = ref(false)

let seq = 0
async function load() {
    const dir = app.repoDir
    if (!dir) return
    const n = ++seq
    const note = await window.api.readRepoNote(dir).catch(() => '')
    if (n !== seq) return
    text.value = note
    loaded.value = true
    expanded.value = false
    await nextTick()
    long.value = !!body.value && body.value.scrollHeight > body.value.clientHeight + 4
}
watch(() => [app.repoDir, app.reloadKey], load, { immediate: true })

function edit() {
    draft.value = text.value
    editing.value = true
}
async function save() {
    const recorded = await app.run(() => window.api.saveRepoNote(app.repoDir!, draft.value))
    if (recorded === undefined) return
    editing.value = false
    await load()
    if (recorded) {
        app.notify('メモを保存しました')
        if (app.prefs.pushOnSave) await app.sync()
    }
}
function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') editing.value = false
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save()
}
</script>

<template>
    <section class="cd-side-sec">
        <SectionHead label="メモ" icon="i-lucide-notebook-text">
            <UTooltip v-if="!editing && text" text="編集">
                <UButton icon="i-lucide-pencil" size="xs" square color="neutral" variant="ghost" aria-label="メモを編集"
                    @click="edit" />
            </UTooltip>
        </SectionHead>
        <div v-if="editing" class="edit" @keydown="onKey">
            <UTextarea v-model="draft" :rows="5" autoresize :maxrows="14" class="cd-full" autofocus
                placeholder="例：〇〇様からの依頼分。担当：山田。次回の見直しは2027年4月。" />
            <p class="cd-muted hint">見出し（#）と箇条書き（-）を使えます。保存すると版として記録します。同期すると、リポジトリを使うほかの人にも見えます。Ctrl+Enter で保存。</p>
            <div class="row">
                <span class="cd-grow" />
                <UButton label="やめる" size="xs" color="neutral" variant="outline" @click="editing = false" />
                <UButton label="保存" size="xs" :loading="app.busy" @click="save" />
            </div>
        </div>
        <template v-else-if="text">
            <!-- eslint-disable-next-line vue/no-v-html -- markdown-it は html を無効にしている -->
            <div ref="body" class="note" :class="{ clamp: !expanded }" v-html="md.render(text)" />
            <button v-if="long || expanded" class="more" @click="expanded = !expanded">{{ expanded ? '短く表示' : '続きを読む'
                }}</button>
        </template>
        <button v-else-if="loaded" class="empty" @click="edit">
            <UIcon name="i-lucide-plus" />依頼主・担当者・連絡先・次回の見直し予定などを書いておく
        </button>
    </section>
</template>

<style scoped>
.note {
    font-size: 13px;
    line-height: 1.75;
    overflow-wrap: anywhere;
}

.note.clamp {
    max-height: 9.5em;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.note :deep(h1),
.note :deep(h2),
.note :deep(h3) {
    font-size: 13px;
    font-weight: 700;
    margin: 6px 0 2px;
}

.note :deep(p),
.note :deep(ul),
.note :deep(ol) {
    margin: 0 0 4px;
}

.note :deep(ul) {
    list-style: disc;
    padding-left: 1.4em;
}

.note :deep(ol) {
    list-style: decimal;
    padding-left: 1.4em;
}

.more {
    font-size: 12px;
    color: var(--ui-color-primary-500);
    cursor: pointer;
}

.empty {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 10px;
    border: 1px dashed var(--ui-border-accented);
    border-radius: 8px;
    font-size: 12px;
    color: var(--ui-text-muted);
    text-align: left;
    cursor: pointer;
}

.empty:hover {
    border-color: var(--ui-color-primary-500);
    color: var(--ui-text);
}

.hint {
    font-size: 11px;
    margin: 0;
}

.edit {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.row {
    display: flex;
    gap: 6px;
}
</style>
