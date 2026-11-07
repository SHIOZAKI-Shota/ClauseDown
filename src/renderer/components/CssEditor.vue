<script setup lang="ts">
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { legalTheme } from '~/utils/legal-editor'
import { searchPanel } from '~/utils/search-panel'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const host = ref<HTMLDivElement>()
let view: EditorView | null = null
let lastEmitted = props.modelValue

onMounted(() => {
    view = new EditorView({
        parent: host.value!,
        state: EditorState.create({
            doc: props.modelValue,
            extensions: [
                basicSetup,
                css(),
                legalTheme,
                EditorView.lineWrapping,
                EditorState.tabSize.of(2),
                searchPanel(),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) emit('update:modelValue', (lastEmitted = u.state.doc.toString()))
                }),
            ],
        }),
    })
})

watch(
    () => props.modelValue,
    (v) => {
        if (!view || v === lastEmitted) return
        lastEmitted = v
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
    },
)

onBeforeUnmount(() => view?.destroy())
</script>

<template>
    <div ref="host" class="css-editor" />
</template>

<style scoped>
.css-editor {
    height: 420px;
    overflow: hidden;
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    background: var(--cd-ed-bg);
}
</style>
