<script setup lang="ts">
import type { SegmentItem } from '~/components/SegmentSwitch.vue'
import type { RepoEntry } from '@shared/api'
import { FORGE_LABEL, knownBases, matchRemote } from '@shared/forge'
import { cleanSection, groupRepos, sectionNames } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { useT } from '~/composables/useT'
import { useConfirm } from '~/composables/useConfirm'
import { baseName } from '~/utils/folders'
import { sameJson } from '~/utils/ipc'

const app = useApp()
const t = useT()
const ask = useConfirm()
const st = computed(() => t.value.settings)

const mode = ref<'new' | 'open' | 'clone'>('new')
const url = ref('')
const folderPath = ref('')
const folderPaths = ref<string[]>([])
const newName = ref('')
const adding = computed(() => app.busy)
const MODES = computed<SegmentItem<'new' | 'open' | 'clone'>[]>(() => [
    { value: 'new', label: st.value.repos.modes.new, icon: 'i-lucide-folder-plus' },
    { value: 'open', label: st.value.repos.modes.open, icon: 'i-lucide-folder-open' },
    { value: 'clone', label: st.value.repos.modes.clone, icon: 'i-lucide-cloud-download' },
])
watch(mode, () => {
    folderPath.value = ''
    folderPaths.value = []
    newName.value = ''
})
let nameFromUrl = ''
watch(url, (u) => {
    const guess = baseName(u.trim().replace(/\/+$/, '')).replace(/\.git$/, '')
    if (!newName.value || newName.value === nameFromUrl) newName.value = guess
    nameFromUrl = guess
})
const sepChar = computed(() => (folderPath.value.includes('\\') ? '\\' : '/'))
const nameError = computed(() => {
    const n = newName.value.trim()
    if (!n) return ''
    if (/[\\/:*?"<>|]/.test(n)) return st.value.repos.badChars
    if (n.startsWith('.') || n.endsWith('.') || n.endsWith(' ')) return st.value.repos.badDots
    return ''
})
const targetPath = computed(() =>
    folderPath.value && newName.value.trim() && !nameError.value ? `${folderPath.value.replace(/[\\/]+$/, '')}${sepChar.value}${newName.value.trim()}` : '',
)
const canAdd = computed(() => (mode.value === 'open' ? folderPaths.value.length > 0 : !!targetPath.value && (mode.value === 'new' || !!url.value.trim())))
async function pick() {
    if (mode.value === 'open') {
        const picked = await window.api.pickFolders()
        if (picked.length) folderPaths.value = picked
        return
    }
    const d = await window.api.pickFolder()
    if (d) folderPath.value = d
}

async function addOpenRepos() {
    const added: RepoEntry[] = []
    const notRepo: string[] = []
    const already: string[] = []
    await app.run(async () => {
        for (const dir of folderPaths.value) {
            if (app.settings!.repos.some((r) => r.dir === dir)) {
                already.push(baseName(dir))
                continue
            }
            const r = await window.api.openRepo(dir)
            if (r.ok) added.push({ name: baseName(dir), dir })
            else notRepo.push(baseName(dir))
        }
    })
    if (added.length) {
        const repos = [...app.settings!.repos, ...added]
        await app.saveSettings({ ...app.settings!, repos, current: added[0].dir })
        await app.refreshDocs()
        folderPaths.value = []
        for (const r of added) if (await app.checkHouritsu(r.dir)) break
    }
    const m = st.value.repos
    const notes = [notRepo.length ? m.notRepo(notRepo.join(m.listSep)) : '', already.length ? m.already(already.join(m.listSep)) : ''].filter(Boolean)
    if (added.length) app.notify(m.addedN(added.length))
    if (notes.length) app.notify(notes.join(m.noteSep), !added.length || notRepo.length > 0)
    if (added.length) app.view = 'docs'
}

async function addRepo() {
    if (mode.value === 'open') return addOpenRepos()
    const target = targetPath.value
    if (!canAdd.value || !target) return
    const ok = await app.runOk(async () => {
        if (mode.value === 'clone') await window.api.cloneRepo(url.value.trim(), target)
        else await window.api.initRepo(target)
    })
    if (!ok) return
    const entry: RepoEntry = { name: newName.value.trim(), dir: target, url: mode.value === 'clone' ? url.value.trim() : undefined }
    const repos = [...app.settings!.repos.filter((r) => r.dir !== target), entry]
    await app.saveSettings({ ...app.settings!, repos, current: target })
    await app.refreshDocs()
    url.value = ''
    folderPath.value = ''
    newName.value = ''
    app.notify(st.value.repos.created(entry.name, mode.value === 'clone'))
    app.view = 'docs'
    await app.checkHouritsu(target)
}
async function removeRepo(r: RepoEntry) {
    if (
        await ask({
            title: t.value.repo.removeFromList,
            description: t.value.repo.settings.removeDesc,
            confirmLabel: t.value.repo.removeFromList,
            color: 'error',
        })
    )
        await app.forgetRepo(r.dir)
}

const bases = computed<ReturnType<typeof knownBases>>((prev) => {
    const next = app.settings ? knownBases(app.settings) : []
    return prev && sameJson(prev, next) ? prev : next
})
const forgeOf = (r: RepoEntry) => matchRemote(r.url, bases.value)
const parentOf = (p: string) => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '')

const dupOf = ref<RepoEntry | null>(null)
const dupName = ref('')
const dupParent = ref('')
const dupBusy = ref(false)
function startDuplicate(r: RepoEntry) {
    dupOf.value = r
    dupName.value = `${r.name}${st.value.repos.copySuffix}`
    dupParent.value = parentOf(r.dir)
}
async function pickDupParent() {
    const d = await window.api.pickFolder()
    if (d) dupParent.value = d
}
async function duplicate() {
    const r = dupOf.value
    const name = dupName.value.trim()
    if (!r || !name || !dupParent.value) return
    if (r.dir === app.repoDir) await app.flushEditor()
    dupBusy.value = true
    const dest = await app.run(() => window.api.duplicateRepo(r.dir, dupParent.value, name))
    dupBusy.value = false
    if (!dest) return
    await app.saveSettings({ ...app.settings!, repos: [...app.settings!.repos, { name, dir: dest }] })
    dupOf.value = null
    app.notify(st.value.repos.duplicated(r.name, name))
}

const forkOf = ref<RepoEntry | null>(null)
const forkBusy = ref(false)
const forkWhere = computed(() => {
    const m = forkOf.value && forgeOf(forkOf.value)
    return m ? FORGE_LABEL[m.kind] : ''
})
async function fork() {
    const r = forkOf.value
    if (!r) return
    if (r.dir === app.repoDir) await app.flushEditor()
    forkBusy.value = true
    const url = await app.run(() => window.api.forkRepo(r.dir))
    forkBusy.value = false
    if (!url) return
    await app.setRepoUrl(r.dir, url)
    forkOf.value = null
    if (r.dir === app.repoDir) await app.refreshDocs()
    app.notify(st.value.repos.forked(url.replace(/\.git$/, '')))
}

const noSection = computed(() => st.value.repos.noSection)
const repos = computed(() => app.settings?.repos ?? [])
const repoGroups = computed(() => groupRepos(repos.value))
const sectionChoices = computed(() => [noSection.value, ...sectionNames(repos.value)])
function setSection(r: RepoEntry, v: string) {
    const next = v === noSection.value ? undefined : cleanSection(v)
    if (next !== cleanSection(r.section)) void app.moveRepo(r.dir, { section: next })
}
</script>

<template>
    <template v-for="g in repoGroups" :key="g.section || '-'">
        <h3 v-if="g.section" class="repo-sec">{{ g.section }}</h3>
        <SettingRow
            v-for="r in g.repos"
            :key="r.dir"
            :label="r.name + (r.dir === app.repoDir ? t.settings.repos.inUse : '')"
            :description="
                (app.repoStates[r.dir] ?? 'ok') !== 'ok' ? t.settings.repos.notFoundAt(r.dir) : r.url ? `${r.dir}${t.settings.repos.noteSep}${r.url}` : r.dir
            "
        >
            <USelectMenu
                :model-value="cleanSection(r.section) ?? noSection"
                :items="sectionChoices"
                create-item
                size="sm"
                icon="i-lucide-folder"
                class="sec-select"
                :aria-label="t.settings.repos.section"
                @update:model-value="(v: string) => setSection(r, v)"
                @create="(v: string) => setSection(r, v)"
            />
            <template v-if="(app.repoStates[r.dir] ?? 'ok') !== 'ok'">
                <UBadge :label="t.settings.repos.notFound" color="warning" variant="subtle" icon="i-lucide-folder-x" />
                <UButton :label="t.settings.repos.relocate" size="sm" color="neutral" variant="outline" @click="app.relocateRepo(r.dir)" />
            </template>
            <UButton
                v-else-if="r.dir !== app.repoDir"
                :label="t.settings.repos.switchTo"
                size="sm"
                color="neutral"
                variant="outline"
                @click="app.switchRepo(r.dir)"
            />
            <template v-if="(app.repoStates[r.dir] ?? 'ok') === 'ok'">
                <UButton
                    :label="t.settings.repos.duplicate"
                    icon="i-lucide-copy"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    :title="t.settings.repos.duplicateTitle"
                    @click="startDuplicate(r)"
                />
                <UButton
                    v-if="forgeOf(r)"
                    :label="t.settings.repos.fork"
                    icon="i-lucide-git-fork"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    :title="t.settings.repos.forkTitle"
                    @click="forkOf = r"
                />
            </template>
            <UButton :label="t.settings.repos.remove" size="sm" color="error" variant="ghost" :title="t.settings.repos.removeTitle" @click="removeRepo(r)" />
        </SettingRow>
    </template>
    <p v-if="repos.length === 0" class="cd-muted">{{ t.settings.repos.empty }}</p>

    <h3>{{ t.settings.repos.addHeading }}</h3>
    <SettingRow :label="t.settings.repos.addMethod" stacked>
        <SegmentSwitch v-model="mode" :items="MODES" :aria-label="t.settings.repos.addMethod" />
    </SettingRow>
    <SettingRow v-if="mode === 'clone'" :label="t.settings.repos.url" :description="t.settings.repos.urlDesc">
        <UInput v-model="url" class="cd-w-wide" :placeholder="t.settings.repos.urlPlaceholder" />
    </SettingRow>
    <SettingRow v-if="mode === 'open'" :label="t.settings.repos.folder" :description="t.settings.repos.folderDesc(MOD_KEY)">
        <span class="path">{{ folderPaths.length ? t.settings.repos.selectedCount(folderPaths.length) : t.settings.unselected }}</span>
        <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
    </SettingRow>
    <ul v-if="mode === 'open' && folderPaths.length" class="picked">
        <li v-for="p in folderPaths" :key="p" :title="p">
            <UIcon name="i-lucide-folder" />{{ baseName(p) }}
            <span class="cd-muted">{{ p }}</span>
        </li>
    </ul>
    <template v-else-if="mode !== 'open'">
        <SettingRow :label="t.settings.repos.name" :description="nameError || t.settings.repos.nameDesc">
            <UInput
                v-model="newName"
                class="cd-w-input"
                :placeholder="t.settings.repos.namePlaceholder"
                :color="nameError ? 'error' : undefined"
                :highlight="!!nameError"
            />
        </SettingRow>
        <SettingRow :label="t.settings.repos.location" :description="t.settings.repos.locationDesc">
            <span class="path">{{ folderPath || t.settings.unselected }}</span>
            <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pick" />
        </SettingRow>
    </template>
    <div class="actions">
        <span v-if="mode !== 'open' && targetPath" class="cd-muted target"> <UIcon name="i-lucide-folder-plus" />{{ targetPath }} </span>
        <UButton
            :label="
                mode === 'open'
                    ? folderPaths.length > 1
                        ? t.settings.repos.addN(folderPaths.length)
                        : t.settings.add
                    : mode === 'clone'
                      ? t.settings.repos.cloneAdd
                      : t.settings.repos.createAdd
            "
            :disabled="!canAdd"
            :loading="adding"
            @click="addRepo"
        />
    </div>

    <UModal
        :open="!!dupOf"
        :title="t.settings.repos.dupTitle"
        :description="t.settings.repos.dupDesc(dupOf?.name ?? '')"
        :dismissible="!dupBusy"
        @update:open="(v) => !v && (dupOf = null)"
    >
        <template #body>
            <div class="dup">
                <SettingRow :label="t.settings.repos.dupName" stacked>
                    <UInput v-model="dupName" class="cd-w-input" @keydown.enter="dupName.trim() && dupParent && !dupBusy && duplicate()" />
                </SettingRow>
                <SettingRow :label="t.settings.repos.location" stacked>
                    <span class="path">{{ dupParent || t.settings.unselected }}</span>
                    <UButton :label="t.settings.choose" icon="i-lucide-folder-open" size="sm" color="neutral" variant="outline" @click="pickDupParent" />
                </SettingRow>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <UButton :label="t.common.cancel" color="neutral" variant="outline" :disabled="dupBusy" @click="dupOf = null" />
                <UButton :label="t.settings.repos.duplicate" :loading="dupBusy" :disabled="!dupName.trim() || !dupParent" @click="duplicate" />
            </div>
        </template>
    </UModal>

    <ConfirmModal
        :open="!!forkOf"
        :title="t.settings.repos.forkWith(forkWhere)"
        :confirm-label="t.settings.repos.fork"
        :loading="forkBusy"
        :description="t.settings.repos.forkDesc(forkWhere, forkOf?.name ?? '')"
        @update:open="(v) => !v && !forkBusy && (forkOf = null)"
        @confirm="fork"
    />
</template>

<style scoped>
h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 24px 0 0;
}

h3.repo-sec {
    margin-top: 16px;
    color: var(--ui-text-muted);
}

.sec-select {
    width: 140px;
}

.dup {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.path {
    font-size: 12px;
    color: var(--ui-text-muted);
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.picked {
    list-style: none;
    margin: 0 0 8px;
    padding: 8px 12px;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.picked li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
}

.picked .cd-muted {
    overflow: hidden;
    text-overflow: ellipsis;
}

.actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 12px;
}

.target {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
</style>
