import type { Messages } from '../types'

export const compare: Messages['compare'] = {
	styleTable: 'Comparison table',
	styleInline: 'Diff',
	styleAria: 'Display format',
	title: (doc, inline) => `${doc} ${inline ? 'changes' : 'comparison table'}`,
	exported: 'Exported',
	listLabel: 'Versions to compare',
	before: 'Before',
	after: 'After',
	emptyDoc: 'Empty document',
	omit: 'Collapse unchanged articles',
	changes: (n) => `${n} change${n === 1 ? '' : 's'}`,
}
