import type { DropdownMenuItem } from '@nuxt/ui'
import { cleanSection, sectionNames } from '@shared/repo-sections'
import { useApp } from '~/stores/app'
import { t } from '@shared/i18n'

export function repoSectionItems(dir: string): DropdownMenuItem[][] {
    const app = useApp()
    const repos = app.settings?.repos ?? []
    const current = cleanSection(repos.find((r) => r.dir === dir)?.section)
    return [
        sectionNames(repos).map((name) => ({
            label: name,
            icon: name === current ? 'i-lucide-check' : 'i-lucide-folder',
            color: name === current ? ('primary' as const) : undefined,
            onSelect: () => void (name !== current && app.moveRepo(dir, { section: name })),
        })),
        [
            { label: t().shell.repoSection.create, icon: 'i-lucide-folder-plus', onSelect: () => (app.dialog = { kind: 'sectionName', dir }) },
            ...(current ? [{ label: t().shell.repoSection.leave, icon: 'i-lucide-folder-output', onSelect: () => void app.moveRepo(dir, {}) }] : []),
        ],
    ].filter((g) => g.length)
}
