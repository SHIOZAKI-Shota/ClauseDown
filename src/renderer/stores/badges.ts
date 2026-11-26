import { ref, watch, type Ref } from 'vue'
import { todayISO } from '@shared/date'
import { addDays } from '@shared/schedule'

export function useRepoBadges(repoDir: Ref<string | null>, scheduleKey: Ref<number>) {
	const dueCount = ref<{ due: number; overdue: number } | null>(null)
	let dueSeq = 0
	async function refreshDueCount() {
		const dir = repoDir.value
		const seq = ++dueSeq
		if (!dir) return (dueCount.value = null)
		const today = todayISO()
		const until = addDays(today, 30)
		const r = await window.api.occurrences(dir, addDays(today, -365 * 5), until, today).catch(() => null)
		if (seq !== dueSeq) return
		if (!r) return (dueCount.value = null)
		const due = r.items.filter((o) => o.source !== 'delivery' && (o.overdue || (!o.done && (o.end ?? o.date) >= today && o.date <= until)))
		dueCount.value = { due: due.length, overdue: due.filter((o) => o.overdue).length }
	}

	const openIssueCount = ref<number | null>(null)
	let issueSeq = 0
	async function refreshIssueCount() {
		const dir = repoDir.value
		const seq = ++issueSeq
		if (!dir) return (openIssueCount.value = null)
		const list = await window.api.listIssues(dir).catch(() => null)
		if (seq === issueSeq) openIssueCount.value = list ? list.filter((i) => i.state === 'open').length : null
	}

	watch(scheduleKey, () => void refreshDueCount())
	watch(
		repoDir,
		() => {
			openIssueCount.value = null
			dueCount.value = null
			void refreshIssueCount()
			void refreshDueCount()
		},
		{ immediate: true },
	)
	return { dueCount, refreshDueCount, openIssueCount, refreshIssueCount }
}
