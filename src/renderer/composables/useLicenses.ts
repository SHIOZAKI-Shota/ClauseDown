import type { LicenseList } from '@shared/api'

const data = ref<LicenseList | null>(null)
const loaded = ref(false)
let pending: Promise<void> | undefined

export function useLicenses() {
    pending ??= window.api.getLicenses().then((r) => {
        data.value = r
        loaded.value = true
    })
    return { data, loaded }
}
