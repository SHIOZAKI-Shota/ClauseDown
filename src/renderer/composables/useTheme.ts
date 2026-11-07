import { useApp } from '~/stores/app'

export type ThemeMode = 'light' | 'dark' | 'system'

export function useTheme() {
    const colorMode = useColorMode()
    const app = useApp()
    const dark = computed(() => colorMode.value === 'dark')

    async function set(mode: ThemeMode) {
        colorMode.preference = mode
        if (app.settings) app.settings = { ...app.settings, theme: mode }
        await window.api.setTheme(mode)
    }
    const toggle = () => set(dark.value ? 'light' : 'dark')

    return { dark, set, toggle }
}
