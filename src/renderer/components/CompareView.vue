<script setup lang="ts">
import type { CommitInfo, EffectiveVersion } from '@shared/api'
import { compareSources } from '@shared/article-diff'
import { renderCompareTable, renderInlineDiff } from '@shared/legal-renderer'
import { useApp } from '~/stores/app'
import { toPlain } from '~/utils/ipc'
import { usePane } from '~/composables/usePane'

const app = useApp()
const path = app.currentPath!
const commits = ref<CommitInfo[]>([])
const effective = ref<EffectiveVersion[]>([])
const oldOid = ref('')
const newOid = ref('work')
const oldText = ref('')
const newText = ref('')
const omit = ref(true)
const listPane = usePane('compare-list', { size: 420, min: 300, max: 800 })
const oldList = ref<HTMLElement>()
const newList = ref<HTMLElement>()
const pending = computed(() => !!app.currentDoc?.changed)
const shown = (oid: string) => (oid === 'work' && !pending.value ? (commits.value.find((c) => c.head)?.oid ?? oid) : oid)

async function textOf(oid: string) {
    if (!oid || oid === 'empty') return ''
    if (oid === 'work') return window.api.readDoc(app.repoDir!, path)
    return (await window.api.readAt(app.repoDir!, oid, path)) ?? ''
}

let seq = 0
async function loadTexts() {
    const n = ++seq
    const texts = await Promise.all([textOf(oldOid.value), textOf(newOid.value)])
    if (n === seq) [oldText.value, newText.value] = texts
}

onMounted(async () => {
    const before = [oldOid.value, newOid.value]
    ;[commits.value, effective.value] = await Promise.all([window.api.log(app.repoDir!, path, true), window.api.listEffective(app.repoDir!, path)])
    if (app.compareTarget) {
        oldOid.value = app.compareTarget.oldOid
        newOid.value = app.compareTarget.newOid
    } else if (app.onDraft && app.mainBranch) {
        oldOid.value = app.mainBranch.oid
        newOid.value = 'work'
    } else if (effective.value[0]) {
        oldOid.value = effective.value[0].oid
        newOid.value = 'work'
    } else {
        const changed = app.currentDoc?.changed
        oldOid.value = (changed ? commits.value[0]?.oid : commits.value[1]?.oid) ?? 'empty'
        newOid.value = changed || !commits.value[0] ? 'work' : commits.value[0].oid
    }
    if (oldOid.value === before[0] && newOid.value === before[1]) await loadTexts()
    await nextTick()
    for (const el of [oldList.value, newList.value]) el?.querySelector('.row.on')?.scrollIntoView({ block: 'center' })
})
watch([oldOid, newOid], loadTexts)

const rows = computed(() => compareSources(oldText.value, newText.value))
const changes = computed(() => rows.value.filter((r) => r.status !== 'same').length)
const STYLES = [
    { value: 'table', label: '新旧対照表 形式', icon: 'i-lucide-columns-2' },
    { value: 'inline', label: 'Diff 形式', icon: 'i-lucide-file-diff' },
]
const style = computed({
    get: () => app.prefs.compareStyle ?? 'table',
    set: (v: 'table' | 'inline') => app.setPrefsLive({ compareStyle: v }),
})
const html = computed(() =>
    withImages(
        style.value === 'inline' ? renderInlineDiff(rows.value, { omitUnchanged: omit.value }) : renderCompareTable(rows.value, { omitUnchanged: omit.value }),
        app.repoDir,
        app.currentPath,
    ),
)

const title = computed(() => `${app.currentDoc?.title ?? ''} ${style.value === 'inline' ? '変更箇所' : '新旧対照表'}`)

async function exportAs(format: 'pdf' | 'docx') {
    const out = await app.run(() =>
        window.api.exportFile({
            kind: 'compare',
            format,
            oldSource: oldText.value,
            newSource: newText.value,
            title: title.value,
            name: title.value.replace(/\s+/g, '_'),
            omitUnchanged: omit.value,
            compareStyle: style.value,
            style: toPlain(app.style),
            dir: app.repoDir!,
            docPath: app.currentPath!,
        }),
    )
    if (out) app.notifyExported('書き出しました', out)
}
</script>

<template>
    <div class="compare">
        <SidePane :pane="listPane" side="left" label="比べる版" icon="i-lucide-git-compare">
            <div class="lists">
                <section class="list">
                    <div class="list-head">
                        <span class="badge old">改正前</span>
                        <UButton
                            label="空の文書"
                            size="xs"
                            :color="oldOid === 'empty' ? 'primary' : 'neutral'"
                            :variant="oldOid === 'empty' ? 'soft' : 'ghost'"
                            @click="oldOid = 'empty'"
                        />
                    </div>
                    <div ref="oldList" class="list-body">
                        <HistoryGraph
                            :commits="commits"
                            :selected="shown(oldOid)"
                            :pending="pending"
                            pick-work
                            :current-label="app.currentBranch?.label"
                            @select="oldOid = $event"
                        />
                    </div>
                </section>
                <section class="list">
                    <div class="list-head">
                        <span class="badge new">改正後</span>
                    </div>
                    <div ref="newList" class="list-body">
                        <HistoryGraph
                            :commits="commits"
                            :selected="shown(newOid)"
                            :pending="pending"
                            pick-work
                            :current-label="app.currentBranch?.label"
                            @select="newOid = $event"
                        />
                    </div>
                </section>
            </div>
        </SidePane>
        <div class="main">
            <div class="cd-toolbar bar">
                <SegmentSwitch v-model="style" :items="STYLES" aria-label="表示の形式" />
                <UCheckbox v-model="omit" label="変更のない条は（略）にする" />
                <span class="cd-grow" />
                <UBadge :label="`変更 ${changes} か所`" color="neutral" variant="subtle" />
                <UButton label="PDF" icon="i-lucide-file-down" size="sm" color="neutral" variant="outline" @click="exportAs('pdf')" />
                <UButton label="Word" icon="i-lucide-file-down" size="sm" color="neutral" variant="outline" @click="exportAs('docx')" />
            </div>
            <div class="cd-preview cd-canvas">
                <div class="paper cd-paper">
                    <p class="title">{{ title }}</p>
                    <p v-if="style === 'inline'" class="legend">
                        <del class="cd-del">削除文字</del>
                        <ins class="cd-ins">追加文字</ins>
                    </p>
                    <div v-html="html" />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.compare {
    display: flex;
    height: 100%;
    min-height: 0;
}

.main {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.bar {
    gap: 10px;
    padding: 8px 16px;
}

.lists {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.list {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
}

.list + .list {
    border-top: 1px solid var(--ui-border-accented);
}

.list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
    padding: 6px 12px;
    border-bottom: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
}

.badge {
    font-size: 12px;
    font-weight: 700;
    padding: 1px 8px;
    border-radius: 999px;
}

.badge.old {
    color: var(--cd-del);
    background: color-mix(in srgb, var(--cd-del) 12%, transparent);
}

.badge.new {
    color: var(--cd-ins);
    background: color-mix(in srgb, var(--cd-ins) 12%, transparent);
}

.list-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
}

.paper {
    max-width: 297mm;
    margin: 0 auto;
    padding: 15mm;
}

.legend {
    text-align: center;
    font-size: 9pt;
    margin: -4px 0 12px;
}

.title {
    text-align: center;
    font-family: 'Yu Mincho', serif;
    font-size: 12pt;
    margin: 0 0 10px;
}
</style>
