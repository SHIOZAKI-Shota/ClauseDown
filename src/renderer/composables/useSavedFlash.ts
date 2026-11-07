export function useSavedFlash(ms = 1500) {
    const saved = ref(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    function flash() {
        saved.value = true
        clearTimeout(timer)
        timer = setTimeout(() => (saved.value = false), ms)
    }
    onBeforeUnmount(() => clearTimeout(timer))
    return { saved, flash }
}
