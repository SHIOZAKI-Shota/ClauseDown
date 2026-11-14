export default defineNuxtPlugin({
    name: 'demo-api',
    enforce: 'pre',
    async setup(nuxtApp) {
        if (!useRuntimeConfig().public.demo) return
        const { createDemoApi } = await import('~/demo/api')
        const { setDictionaryPath } = await import('~/demo/proofread')
        setDictionaryPath(`${useRuntimeConfig().app.baseURL}dict/`)
        window.api = createDemoApi()
        window.addEventListener('message', (e) => {
            const data = e.data as { type?: string; theme?: string } | null
            if (e.origin !== location.origin || data?.type !== 'clausedown-theme') return
            const theme = data.theme
            if (theme !== 'light' && theme !== 'dark') return
            const colorMode = nuxtApp.runWithContext(() => useColorMode()) as ReturnType<typeof useColorMode>
            if (colorMode.preference === theme) return
            colorMode.preference = theme
            void window.api.setTheme(theme)
        })
        const { startGuide } = await import('~/demo/guide')
        const { useApp } = await import('~/stores/app')
        nuxtApp.hook('app:mounted', () => {
            const app = nuxtApp.runWithContext(() => useApp()) as ReturnType<typeof useApp>
            startGuide(
                () => app.view,
                (fn) => watch(() => app.view, fn),
            )
        })
    },
})
