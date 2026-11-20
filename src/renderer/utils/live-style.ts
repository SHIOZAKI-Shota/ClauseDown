import { shallowRef, watchEffect, type Directive, type ShallowRef } from 'vue'

type StyleGetter = () => Record<string, string> | undefined

const bound = new WeakMap<HTMLElement, { get: ShallowRef<StyleGetter>; stop: () => void }>()
const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export const vLiveStyle: Directive<HTMLElement, StyleGetter> = {
    mounted(el, binding) {
        const get = shallowRef(binding.value)
        let prev: string[] = []
        const stop = watchEffect(() => {
            const style = get.value() ?? {}
            for (const k of prev) if (!(k in style)) el.style.removeProperty(kebab(k))
            for (const [k, v] of Object.entries(style)) el.style.setProperty(kebab(k), v)
            prev = Object.keys(style)
        })
        bound.set(el, { get, stop })
    },
    updated(el, binding) {
        const b = bound.get(el)
        if (b && b.get.value !== binding.value) b.get.value = binding.value
    },
    unmounted(el) {
        bound.get(el)?.stop()
        bound.delete(el)
    },
}
