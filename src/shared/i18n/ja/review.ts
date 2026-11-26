export const review = {
	title: (label: string) => `確認依頼：${label}`,
	actions: {
		request: '確認を依頼',
		approve: '承認',
		changes: '修正を依頼',
		comment: 'コメント',
		withdraw: '依頼を取り下げ',
	},
	// 経過の一行。「<名前> が確認を依頼」の「が確認を依頼」の部分
	events: {
		request: 'が確認を依頼',
		approve: 'が承認',
		changes: 'が修正を依頼',
		comment: 'がコメント',
		withdraw: 'が依頼を取り下げ',
	},
	done: {
		request: '確認を依頼しました',
		approve: '承認しました',
		changes: '修正を依頼しました',
		comment: 'コメントしました',
		withdraw: '依頼を取り下げました',
	},
	commentRequired: 'コメントを入力してください',
	rules: (required: boolean, approvers: string[]) =>
		`承認：${required ? '現行版に反映するには必要' : '任意'} ／ 承認できる人：${approvers.length ? approvers.join('、') : '依頼した人以外の誰でも'}`,
	noEvents: 'まだ記録はありません。',
	unsaved: '保存していない変更があります',
	unsavedHint: '確認してもらうのは保存した版です。先に「版を保存」してください。',
	placeholderOpen: 'コメント（修正の依頼では必須）',
	placeholderNew: '確認してほしい点など（任意）',
	requestAgain: '直したので再度依頼',
	compareWithCurrent: '現行版との比較',
	noDiff: '現行版との違いはありません。',
	headDraft: '改定案',
	headCurrent: '現行版',
}
