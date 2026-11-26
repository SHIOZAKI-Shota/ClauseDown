import { contextBridge, ipcRenderer } from 'electron'
import type { AiEvent, Api, DocChangedEvent, OpenScheduleEvent, UpdateState } from '../shared/api'
import { API_METHODS } from '../shared/api-methods'

function listen<T>(channel: string) {
	return (cb: (e: T) => void) => {
		const fn = (_: unknown, e: T) => cb(e)
		ipcRenderer.on(channel, fn)
		return () => {
			ipcRenderer.off(channel, fn)
		}
	}
}

const api = {
	...Object.fromEntries(API_METHODS.map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke(n, ...args)])),
	onDocChanged: listen<DocChangedEvent>('docChanged'),
	onAiEvent: listen<AiEvent>('aiEvent'),
	onOpenSchedule: listen<OpenScheduleEvent>('openSchedule'),
	onUpdateState: listen<UpdateState>('updateState'),
} as unknown as Api

contextBridge.exposeInMainWorld('api', api)
