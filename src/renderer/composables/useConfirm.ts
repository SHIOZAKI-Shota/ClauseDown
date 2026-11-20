export interface ConfirmRequest {
    title: string
    description?: string
    confirmLabel: string
    cancelLabel?: string
    color?: 'primary' | 'error'
}

const current = shallowRef<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null)

export function useConfirm() {
    return (req: ConfirmRequest) =>
        new Promise<boolean>((resolve) => {
            current.value?.resolve(false)
            current.value = { ...req, resolve }
        })
}

export function useConfirmHost() {
    const open = computed({
        get: () => !!current.value,
        set: (v) => {
            if (!v) settle(false)
        },
    })
    function settle(ok: boolean) {
        const c = current.value
        current.value = null
        c?.resolve(ok)
    }
    return { current, open, settle }
}
