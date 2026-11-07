import type { Ref } from 'vue'
import { useStoredRef } from './useStoredRef'

export interface PaneOptions {
    size: number
    min: number
    max: number
}

export interface Pane {
    state: Ref<{ size: number; collapsed: boolean }>
    opts: PaneOptions
    setSize(px: number): void
    grow(step?: number): void
    shrink(step?: number): void
    reset(): void
    collapse(): void
    expand(): void
    toggle(): void
    measure: Ref<(() => number) | null>
}

const STEP = 48

export function usePane(key: string, opts: PaneOptions): Pane {
    const state = useStoredRef(`clausedown.pane.${key}`, { size: opts.size, collapsed: false })
    const measure = ref<(() => number) | null>(null)
    const clamp = (px: number) => Math.round(Math.min(opts.max, Math.max(opts.min, px)))
    const current = () => state.value.size || measure.value?.() || opts.min
    return {
        state,
        opts,
        measure,
        setSize: (px) => (state.value = { ...state.value, size: clamp(px), collapsed: false }),
        grow: (step = STEP) => (state.value = { ...state.value, size: clamp(current() + step), collapsed: false }),
        shrink: (step = STEP) => (state.value = { ...state.value, size: clamp(current() - step), collapsed: false }),
        reset: () => (state.value = { size: opts.size, collapsed: false }),
        collapse: () => (state.value = { ...state.value, collapsed: true }),
        expand: () => (state.value = { ...state.value, collapsed: false }),
        toggle: () => (state.value = { ...state.value, collapsed: !state.value.collapsed }),
    }
}

export function paneStyle(p: Pane): Record<string, string> {
    const { size } = p.state.value
    return size ? { width: `${size}px`, flex: '0 1 auto', minWidth: `${p.opts.min}px` } : { flex: '1 1 0', minWidth: `${p.opts.min}px` }
}
