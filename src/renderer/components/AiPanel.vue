<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import type { AiEvent, AiStatus } from '@shared/api'
import { AI_PRESETS } from '@shared/ai-presets'
import { useApp } from '~/stores/app'
import type { Pane } from '~/composables/usePane'

const props = defineProps<{
    pane?: Pane
    path: string
    selection: () => string
    canRevert: boolean
}>()
const emit = defineEmits<{
    start: []
    end: []
    revert: []
    close: []
}>()

const app = useApp()
const md = new MarkdownIt({ html: false, linkify: false, breaks: true })

interface Turn {
    role: 'user' | 'ai'
    text: string
    html: string
    thinking: string
    tools: string[]
    error?: string
}

let session = crypto.randomUUID()
const turns = ref<Turn[]>([])
const input = ref('')
const running = ref(false)
const status = ref<AiStatus | null>(null)
const sendNote = computed(() => {
    const s = status.value
    if (!s) return ''
    if (s.local) return '文書を PC の外に送信しません。'
    const to = { anthropic: 'Anthropic の Claude API', openai: '設定した接続先', ollama: 'Ollama', openrouter: 'OpenRouter と、選んだモデルの会社', github: 'GitHub Models' }[s.config.provider]
    return `文書の内容は ${to} に送信されます。`
})
const useSelection = ref(true)
const list = ref<HTMLDivElement>()

onMounted(async () => {
    status.value = await window.api.aiStatus()
})

function scrollDown(force = false) {
    const el = list.value
    if (!force && el && el.scrollHeight - el.scrollTop - el.clientHeight > 48) return
    nextTick(() => list.value?.scrollTo({ top: list.value.scrollHeight }))
}

let pending: { text: string; thinking: string } = { text: '', thinking: '' }
let frame = 0
function flushStream() {
    cancelAnimationFrame(frame)
    frame = 0
    const last = turns.value[turns.value.length - 1]
    if (last?.role === 'ai' && (pending.text || pending.thinking)) {
        last.thinking += pending.thinking
        if (pending.text) {
            last.text += pending.text
            last.html = md.render(last.text)
        }
        scrollDown()
    }
    pending = { text: '', thinking: '' }
}

const off = window.api.onAiEvent((e: AiEvent) => {
    if (e.session !== session) return
    const last = turns.value[turns.value.length - 1]
    if (!last || last.role !== 'ai') return
    if (e.type === 'text' || e.type === 'thinking') {
        pending[e.type] += e.text
        frame ||= requestAnimationFrame(flushStream)
        return
    }
    flushStream()
    if (e.type === 'tool') last.tools.push(e.label)
    else if (e.type === 'error') last.error = e.message
    if (e.type === 'done' || e.type === 'error') finish()
    scrollDown()
})
onBeforeUnmount(() => {
    off()
    cancelAnimationFrame(frame)
    if (running.value) void window.api.aiStop(session)
})

function finish() {
    flushStream()
    if (!running.value) return
    running.value = false
    emit('end')
}

async function send(text = input.value) {
    const instruction = text.trim()
    if (!instruction || running.value) return
    const selection = useSelection.value ? props.selection().trim() : ''
    input.value = ''
    turns.value.push({ role: 'user', text: selection ? `${instruction}\n\n（選んでいる部分について）` : instruction, html: '', thinking: '', tools: [] })
    turns.value.push({ role: 'ai', text: '', html: '', thinking: '', tools: [] })
    running.value = true
    emit('start')
    scrollDown(true)
    try {
        await window.api.aiRun(app.repoDir!, { session, path: props.path, instruction, selection: selection || undefined })
    } catch (e) {
        const last = turns.value[turns.value.length - 1]
        last.error = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
    finish()
}

async function stop() {
    await window.api.aiStop(session)
}

async function reset() {
    await window.api.aiReset(session)
    session = crypto.randomUUID()
    pending = { text: '', thinking: '' }
    turns.value = []
    running.value = false
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        send()
    }
}

function openSettings() {
    app.openSettings('setup', 'ai')
}
</script>

<template>
    <aside class="ai-panel">
        <header class="head">
            <UIcon name="i-lucide-sparkles" class="mark" />
            <span class="title">AI</span>
            <button v-if="status?.ready" class="which"
                :title="status.local ? 'ローカル の中で動いています（文書を PC の外に送信しません）' : '設定の「AI」で変えられます'" @click="openSettings">
                <UIcon v-if="status.local" name="i-lucide-shield-check" />{{ status.label }}
            </button>
            <span class="cd-grow" />
            <UTooltip text="新しい会話">
                <UButton icon="i-lucide-message-square-plus" size="xs" square color="neutral" variant="ghost"
                    :disabled="!turns.length" aria-label="新しい会話" @click="reset" />
            </UTooltip>
            <PaneControls v-if="pane" :pane="pane" side="right" label="AI" />
            <UTooltip text="閉じる">
                <UButton icon="i-lucide-x" size="xs" square color="neutral" variant="ghost" aria-label="閉じる"
                    @click="emit('close')" />
            </UTooltip>
        </header>

        <div v-if="status && !status.ready" class="setup">
            <p>AI を使うには、設定の「AI」で接続先を設定してください。</p>
            <p class="cd-muted">{{ status.reason }}</p>
            <UButton label="設定を開く" icon="i-lucide-settings" size="sm" @click="openSettings" />
        </div>

        <template v-else>
            <div ref="list" class="list">
                <div v-if="!turns.length" class="presets">
                    <p class="cd-muted lead">この文書について、AI に頼めます。</p>
                    <button v-for="p in AI_PRESETS" :key="p.id" class="preset" :disabled="running"
                        @click="send(p.prompt)">
                        <UIcon :name="p.icon" class="icon" />
                        <span>
                            <span class="label">{{ p.label }}</span>
                            <span class="desc">{{ p.description }}</span>
                        </span>
                    </button>
                </div>
                <div v-for="(t, i) in turns" :key="i" :class="['turn', t.role]">
                    <div v-if="t.role === 'user'" class="bubble">{{ t.text }}</div>
                    <template v-else>
                        <details v-if="t.thinking.trim()" class="reasoning"
                            :open="running && i === turns.length - 1 && !t.text">
                            <summary>{{ running && i === turns.length - 1 && !t.text ? '思考中…' : '思考' }}</summary>
                            <div class="reasoning-body">{{ t.thinking.trim() }}</div>
                        </details>
                        <ul v-if="t.tools.length" class="tools">
                            <li v-for="(l, j) in t.tools" :key="j">
                                <UIcon name="i-lucide-wrench" />{{ l }}
                            </li>
                        </ul>
                        <!-- eslint-disable-next-line vue/no-v-html -- markdown-it は html を無効にしている -->
                        <div v-if="t.text" class="answer" v-html="t.html" />
                        <div v-else-if="running && i === turns.length - 1 && !t.thinking.trim()" class="thinking">
                            <UIcon name="i-lucide-loader" class="spin" />考えています…
                        </div>
                        <UAlert v-if="t.error" :description="t.error" color="error" variant="subtle"
                            icon="i-lucide-circle-alert" />
                    </template>
                </div>
            </div>

            <div v-if="canRevert && !running" class="revert">
                <span class="cd-muted">AI が文書を書き換えました。版はまだ保存していません。</span>
                <UButton label="依頼の前に戻す" icon="i-lucide-undo-2" size="xs" color="neutral" variant="outline"
                    @click="emit('revert')" />
            </div>

            <footer class="foot">
                <UTextarea v-model="input" :rows="2" autoresize :maxrows="8" class="cd-full"
                    placeholder="例：第5条の試用期間を2か月にして、延長の規定も足して" :disabled="running" @keydown="onKey" />
                <div class="row">
                    <UCheckbox v-model="useSelection" label="選んでいる部分を伝える" size="xs" />
                    <span class="cd-grow" />
                    <UButton v-if="running" label="止める" icon="i-lucide-square" size="sm" color="neutral"
                        variant="outline" @click="stop" />
                    <UButton v-else label="頼む" icon="i-lucide-send" size="sm" :disabled="!input.trim()"
                        @click="send()" />
                </div>
                <p class="note">{{ sendNote }}Ctrl+Enter で送信</p>
            </footer>
        </template>
    </aside>
</template>

<style scoped>
.ai-panel {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--ui-border);
    background: var(--ui-bg);
}

.head {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    flex-shrink: 0;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--ui-border);
}

.mark {
    color: var(--ui-color-primary-500);
}

.title {
    font-weight: 600;
    font-size: 13px;
}

.setup {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
    font-size: 13px;
}

.list {
    flex: 1;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.lead {
    font-size: 12px;
    margin: 0 0 4px;
}

.presets {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.preset {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    text-align: left;
    padding: 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--ui-bg);
    cursor: pointer;
}

.preset:hover:not(:disabled) {
    background: var(--ui-bg-elevated);
}

.preset .icon {
    margin-top: 2px;
    color: var(--ui-color-primary-500);
    flex-shrink: 0;
}

.preset .label {
    display: block;
    font-size: 13px;
    font-weight: 600;
}

.preset .desc {
    display: block;
    font-size: 11px;
    color: var(--ui-text-muted);
    line-height: 1.5;
}

.turn.user {
    align-self: flex-end;
    max-width: 90%;
}

.bubble {
    white-space: pre-wrap;
    font-size: 13px;
    background: var(--ui-bg-elevated);
    border-radius: 10px;
    padding: 6px 10px;
}

.reasoning {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.reasoning summary {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    cursor: pointer;
    user-select: none;
}

.reasoning-body {
    margin-top: 4px;
    padding: 6px 8px;
    border-left: 2px solid var(--ui-border);
    white-space: pre-wrap;
    line-height: 1.6;
    max-height: 240px;
    overflow: auto;
}

.tools {
    list-style: none;
    margin: 0 0 6px;
    padding: 0;
    font-size: 11px;
    color: var(--ui-text-muted);
}

.tools li {
    display: flex;
    gap: 4px;
    align-items: center;
}

.answer {
    font-size: 13px;
    line-height: 1.7;
    overflow-wrap: anywhere;
}

.answer :deep(p),
.answer :deep(ul),
.answer :deep(ol) {
    margin: 0 0 8px;
}

.answer :deep(ul),
.answer :deep(ol) {
    padding-left: 1.4em;
}

.answer :deep(ul) {
    list-style: disc;
}

.answer :deep(ol) {
    list-style: decimal;
}

.answer :deep(h1),
.answer :deep(h2),
.answer :deep(h3) {
    font-size: 13px;
    font-weight: 700;
    margin: 12px 0 4px;
}

.answer :deep(code) {
    font-size: 12px;
    background: var(--ui-bg-elevated);
    padding: 0 3px;
    border-radius: 3px;
}

.answer :deep(pre) {
    background: var(--ui-bg-elevated);
    padding: 6px 8px;
    border-radius: 6px;
    overflow: auto;
    margin: 0 0 8px;
}

.answer :deep(table) {
    border-collapse: collapse;
    margin: 0 0 8px;
    font-size: 12px;
}

.answer :deep(th),
.answer :deep(td) {
    border: 1px solid var(--ui-border);
    padding: 2px 6px;
}

.thinking {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: var(--ui-text-muted);
}

.spin {
    animation: spin 1.2s linear infinite;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.revert {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    padding: 8px 12px;
    font-size: 12px;
    border-top: 1px solid var(--ui-border);
    background: var(--ui-bg-elevated);
}

.foot {
    padding: 8px 12px 10px;
    border-top: 1px solid var(--ui-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.note {
    font-size: 11px;
    color: var(--ui-text-dimmed);
    margin: 0;
}

.which {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    max-width: 180px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 11px;
    color: var(--ui-text-muted);
    cursor: pointer;
}

.which:hover {
    color: var(--ui-text);
}
</style>
