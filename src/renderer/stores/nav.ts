import { computed, ref, watch, type Ref } from 'vue'

export type View = 'home' | 'setup' | 'about' | 'repo' | 'docs' | 'schedule' | 'issues' | 'editor' | 'history' | 'compare' | 'releases'
export type Page = 'issues' | 'schedule'
type DocView = 'editor' | 'history' | 'compare' | 'releases'

const OVERLAY = new Set<View>(['setup', 'about', 'repo'])
const DOC_VIEWS = new Set<View>(['editor', 'history', 'compare', 'releases'])
const PAGES = new Set<View>(['issues', 'schedule'])

export const isDocView = (v: View): v is DocView => DOC_VIEWS.has(v)

export function backTargetOf(from: View | null, o: { hasRepo: boolean; hasDoc: boolean }): View {
	if (!o.hasRepo || !from) return 'home'
	if (isDocView(from) && !o.hasDoc) return 'docs'
	return from
}

export function pageBackOf(page: Page, from: View | null, o: { hasRepo: boolean; hasDoc: boolean }): View {
	if (!from || from === page || !o.hasRepo) return o.hasRepo ? 'docs' : 'home'
	if (isDocView(from) && !o.hasDoc) return 'docs'
	return from
}

export function useNav(view: Ref<View>, o: { hasRepo: () => boolean; hasDoc: () => boolean; label: (v: View) => string; onEnterDocs: () => void }) {
	const returnView = ref<View | null>(null)
	const lastDocView = ref<DocView>('editor')
	const pageFrom = ref<Record<Page, View | null>>({ issues: null, schedule: null })
	watch(view, (to, from) => {
		if (OVERLAY.has(to) && !OVERLAY.has(from)) returnView.value = from
		if (PAGES.has(to) && from !== to && !OVERLAY.has(from)) pageFrom.value[to as Page] = from
		if (to === 'docs') o.onEnterDocs()
		if (isDocView(to)) lastDocView.value = to
	})
	const state = () => ({ hasRepo: o.hasRepo(), hasDoc: o.hasDoc() })
	const backTarget = computed(() => backTargetOf(returnView.value, state()))
	const returnLabel = computed(() => o.label(backTarget.value))
	const pageBack = (page: Page) => pageBackOf(page, pageFrom.value[page], state())
	const pageReturnLabel = (page: Page) => o.label(pageBack(page))
	const leavePage = (page: Page) => (view.value = pageBack(page))
	const goBack = () => (view.value = backTarget.value)
	const goRepoHome = () => (view.value = o.hasRepo() ? 'docs' : 'home')
	return { returnView, lastDocView, backTarget, returnLabel, pageReturnLabel, leavePage, goBack, goRepoHome }
}
