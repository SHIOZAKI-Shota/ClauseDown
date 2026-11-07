<script setup lang="ts">
import { parseLegal } from '@shared/legal-parser'
import { renderDoc } from '@shared/legal-renderer'
import { cssFont } from '@shared/prefs'
import { useApp } from '~/stores/app'

const props = defineProps<{ path: string }>()
const app = useApp()

const PAPER_PX = 794 // A4幅
const host = ref<HTMLDivElement>()
const html = ref<string | null>(null)
const scale = ref(0.3)

const PREFIX = 8000
const CONFIG_RE = /<!--\s*clausedown\b[\s\S]*?-->/
function headOf(src: string): string {
    if (src.length <= PREFIX) return src
    const cut = src.lastIndexOf('\n', PREFIX)
    let head = src.slice(0, cut > 0 ? cut : PREFIX)
    const config = CONFIG_RE.exec(src)
    if (config && config.index + config[0].length > head.length) head += `\n\n${config[0]}\n`
    return head
}

let seq = 0
async function load() {
    const n = ++seq
    try {
        const src = await window.api.readDoc(app.repoDir!, props.path)
        if (n === seq) html.value = renderDoc(parseLegal(headOf(src)))
    } catch {
        if (n === seq) html.value = null
    }
}

const vars = computed(() => {
    const s = app.styleFor(props.path)
    return {
        '--cd-font': cssFont(s.font),
        '--cd-size': `${s.fontSize}pt`,
        '--cd-line': String(s.lineHeight),
        '--cd-margin': `${s.margin}mm`,
        transform: `scale(${scale.value}) translate(-9%, -48px)`,
    }
})

let seen: IntersectionObserver | null = null
let sized: ResizeObserver | null = null
onMounted(() => {
    seen = new IntersectionObserver(
        (entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                seen?.disconnect()
                void load()
            }
        },
        { rootMargin: '200px' },
    )
    seen.observe(host.value!)
    sized = new ResizeObserver(() => {
        if (host.value) scale.value = host.value.clientWidth / (PAPER_PX * 0.82)
    })
    sized.observe(host.value!)
})

const off = app.onDocChanged((e) => {
    if (e.dir === app.repoDir && e.path === props.path && html.value !== null) void load()
})
onBeforeUnmount(() => {
    seen?.disconnect()
    sized?.disconnect()
    off()
})
</script>

<template>
    <div class="thumb" aria-hidden="true">
        <div ref="host" class="sheet cd-paper">
            <div v-if="html !== null" class="paper cd-paper" :style="vars" v-html="html" />
        </div>
    </div>
</template>

<style scoped>
.thumb {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    user-select: none;
    background: var(--cd-canvas);
}

.sheet {
    position: absolute;
    inset: 16px 22px 0;
    overflow: hidden;
    border-radius: 3px 3px 0 0;
}

.paper {
    width: 210mm;
    min-height: 297mm;
    padding: var(--cd-margin, 20mm);
    transform-origin: top left;
    box-shadow: none;
    border-radius: 0;
}

.thumb::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    height: 45%;
    background: linear-gradient(transparent, var(--cd-canvas));
}
</style>
