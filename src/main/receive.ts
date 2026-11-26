import { BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { DeliveryRecord } from '../shared/api'
import { t } from '../shared/i18n'
import { writeAtomic } from './atomic'
import { author, identity } from './git-base'
import { uniquePath } from './util'
import { listDeliveries, recordReceived } from './workflow'

type ReceivedEntry = NonNullable<DeliveryRecord['received']>[number]

export const findDelivery = async (dir: string, id: string) => (await listDeliveries(dir)).find((d) => d.id === id) ?? null

export async function pickFile(parent: BrowserWindow | null, filter: { name: string; extensions: string[] }): Promise<string | null> {
	const opts = { properties: ['openFile'] as 'openFile'[], filters: [filter] }
	const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
	return r.canceled ? null : (r.filePaths[0] ?? null)
}

export async function saveReceived(
	parent: BrowserWindow | null,
	o: {
		dir: string
		delivery: DeliveryRecord
		source: string
		ext: string
		filter: string
		data: string | Uint8Array
		entry: Omit<ReceivedEntry, 'file' | 'at' | 'by'>
	},
): Promise<string | null> {
	const stem = `${basename(o.source).replace(/\.[^.]+$/, '')}${t().signing.received.suffix}`
	let out: string | null
	if (o.delivery.folder && existsSync(o.delivery.folder)) out = uniquePath(o.delivery.folder, stem, o.ext)
	else {
		const opts = { defaultPath: uniquePath(dirname(o.source), stem, o.ext), filters: [{ name: o.filter, extensions: [o.ext] }] }
		const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
		out = r.canceled || !r.filePath ? null : r.filePath
	}
	if (!out) return null
	await writeAtomic(out, o.data)
	const by = (await identity(o.dir).catch(() => null))?.name ?? (await author(o.dir)).name
	await recordReceived(o.dir, o.delivery.id, { file: basename(out), at: new Date().toISOString(), by, ...o.entry })
	return out
}
