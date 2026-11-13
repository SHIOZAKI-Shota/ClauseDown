<script setup lang="ts">
import type { HouritsuConversion } from '@shared/houritsu'
import { useApp } from '~/stores/app'

const props = defineProps<{ dir: string; paths: string[] }>()
const emit = defineEmits<{ close: [] }>()
const app = useApp()

const open = ref(true)
const busy = ref(false)
const result = ref<HouritsuConversion | null>(null)
const repoName = computed(() => app.settings?.repos.find((r) => r.dir === props.dir)?.name ?? '')

watch(open, (v) => !v && emit('close'))

async function convert() {
    busy.value = true
    const r = await app.run(() => window.api.convertHouritsu(props.dir, [...props.paths]))
    busy.value = false
    if (!r) return
    if (props.dir === app.repoDir) await app.refreshDocs()
    if (!r.warnings.length && !r.skipped.length) {
        app.notify(`${r.converted} 件の文書を ClauseDown の形に変えて、版を保存しました`)
        open.value = false
        return
    }
    result.value = r
}
</script>

<template>
    <UModal v-model:open="open" :title="result ? '変換しました' : 'houritsu の形式の文書があります'" :dismissible="!busy">
        <template #body>
            <div v-if="!result" class="body">
                <p>
                    「{{ repoName }}」に、houritsu（e-Gov の法令を Markdown にしたもの）の形式の文書が {{ paths.length }} 件あります。 ClauseDown
                    の形に変えて、1 つの版として保存しますか？
                </p>
                <ul class="cd-muted notes">
                    <li>条・項・号の番号と本文は、そのまま残ります。</li>
                    <li>編・節・款・目の見出しは消え、章の見出しだけが残ります。</li>
                    <li>元の形は、版の履歴に残ります。設定の Developer の「試験中の機能」で「Markdown（houritsu）に書き出す」をオンにすると、書き出しで元の形に戻して保存することもできます。</li>
                </ul>
            </div>
            <div v-else class="body">
                <p>{{ result.converted }} 件の文書を ClauseDown の形に変えて、版を保存しました。</p>
                <p v-if="result.skipped.length" class="cd-muted">
                    保存していない変更がある {{ result.skipped.length }} 件は、変えていません：{{ result.skipped.join('、') }}
                </p>
                <template v-if="result.warnings.length">
                    <p>次の文書は、内容を確かめてください。</p>
                    <ul class="warns">
                        <li v-for="w in result.warnings" :key="w.path">
                            <strong>{{ w.path }}</strong>
                            <span v-for="m in w.messages" :key="m" class="cd-muted">{{ m }}</span>
                        </li>
                    </ul>
                </template>
            </div>
        </template>
        <template #footer>
            <div class="cd-modal-foot">
                <template v-if="!result">
                    <UButton label="変えない" color="neutral" variant="outline" :disabled="busy" @click="open = false" />
                    <UButton label="変えて版を保存" :loading="busy" @click="convert" />
                </template>
                <UButton v-else label="閉じる" @click="open = false" />
            </div>
        </template>
    </UModal>
</template>

<style scoped>
.body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 14px;
}

.notes {
    margin: 0;
    padding-left: 1.2em;
    list-style: disc;
    font-size: 13px;
}

.warns {
    max-height: 240px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
}

.warns li {
    display: flex;
    flex-direction: column;
}
</style>
