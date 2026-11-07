export function useDebounced(fn: () => unknown, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined
    return () => {
        clearTimeout(timer)
        timer = setTimeout(fn, ms)
    }
}
