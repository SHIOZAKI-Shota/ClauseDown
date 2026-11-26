export const compare = {
	styleTable: '新旧対照表 形式',
	styleInline: 'Diff 形式',
	styleAria: '表示の形式',
	title: (doc: string, inline: boolean) => `${doc} ${inline ? '変更箇所' : '新旧対照表'}`,
	exported: '書き出しました',
	listLabel: '比べる版',
	before: '改正前',
	after: '改正後',
	emptyDoc: '空の文書',
	omit: '変更のない条は（略）にする',
	changes: (n: number) => `変更 ${n} か所`,
}
