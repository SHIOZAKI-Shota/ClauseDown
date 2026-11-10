import { contextBridge, ipcRenderer } from 'electron'
import type { AiEvent, Api, DocChangedEvent, OpenScheduleEvent, UpdateState } from '../shared/api'

const names: (keyof Api)[] = [
    'getSettings', 'setTheme', 'platform', 'listFonts', 'saveSettings', 'resetAll', 'suggestVersionMessage', 'duplicateRepo', 'forkRepo', 'createSamples', 'detectHouritsu', 'convertHouritsu', 'hasToken', 'setToken', 'pickFolder', 'pickFolders', 'cloneRepo', 'publishRepo', 'changeRemote', 'disconnectRemote', 'openRepo', 'repoStatus', 'initRepo',
    'listDocs', 'readDoc', 'writeDoc', 'createDoc', 'moveDoc', 'copyDoc', 'copyDocToRepo', 'deleteDoc', 'showDocInFolder', 'repoActivity', 'scheduleAll', 'readRepoNote', 'saveRepoNote', 'log', 'lastChange', 'readAt', 'saveVersion', 'discardChanges',
    'sync', 'push', 'resolveConflicts', 'exportFile', 'previewPdf', 'saveImage', 'proofread', 'editCommand', 'updateState', 'checkUpdate', 'downloadUpdate', 'installUpdate',
    'listBranches', 'createBranch', 'switchBranch', 'previewMerge', 'mergeBranch', 'deleteBranch',
    'listEffective', 'addEffective', 'removeEffective', 'listFolderStyles', 'saveFolderStyle', 'setZoom', 'getRules', 'saveRules', 'forgeKind', 'listReviews', 'addReview',
    'occurrences', 'occurrencesAll', 'exportSchedule', 'listEvents', 'saveEvent', 'deleteEvent', 'setEventDone', 'getEventKinds', 'saveEventKinds',
    'listDeliveries', 'deliver', 'openPath', 'openExternal', 'getLicenses',
    'accounts', 'identity', 'loginStart', 'loginWait', 'logout',
    'aiStatus', 'setAiKey', 'setAiConfig', 'listAiModels', 'aiLoginOpenRouter', 'testAi', 'getMcpToken', 'regenerateMcpToken', 'setMcp', 'desktopStatus', 'registerDesktop', 'unregisterDesktop', 'aiRun', 'aiStop', 'aiReset',
]

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
    ...Object.fromEntries(names.map((n) => [n, (...args: unknown[]) => ipcRenderer.invoke(n, ...args)])),
    onDocChanged: listen<DocChangedEvent>('docChanged'),
    onAiEvent: listen<AiEvent>('aiEvent'),
    onOpenSchedule: listen<OpenScheduleEvent>('openSchedule'),
    onUpdateState: listen<UpdateState>('updateState'),
} as unknown as Api

contextBridge.exposeInMainWorld('api', api)
