import type { Ref } from 'vue'

export function useStoredRef<T>(key: string, initial: T, opts: { deep?: boolean; delay?: number } = {}): Ref<T> {
    const value = ref(initial) as Ref<T>
    try {
        const raw = localStorage.getItem(key)
        if (raw !== null) {
            const v = JSON.parse(raw)
            const isObj = (x: unknown) => !!x && typeof x === 'object' && !Array.isArray(x)
            value.value = isObj(initial) && isObj(v) ? { ...initial, ...v } : v
        }
    } catch {
        // え～ 対 ばぁ
    }
    const write = () => {
        try {
            localStorage.setItem(key, JSON.stringify(value.value))
        } catch {
        }
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    watch(
        value,
        () => {
            if (!opts.delay) return write()
            clearTimeout(timer)
            timer = setTimeout(write, opts.delay)
        },
        { deep: opts.deep ?? true },
    )
    return value
}
