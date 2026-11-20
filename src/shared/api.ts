import type { Locale } from './i18n'
import type { ExperimentId } from './experiments'
import type { RepoRules, ReviewAction, ReviewEvent } from './review'
import type { AppPrefs, DocStyle } from './prefs'
import type { StyleLayers, StyleOverride } from './folder-style'
import type { ForgeKind, GitLabHost } from './forge'
import type { AiConfig, AiProvider } from './ai-providers'
import type { HouritsuConversion } from './houritsu'
import type { DueEvent, DueEventInput, EventKind, Occurrence, Period, RepoSchedule, ScheduleItem } from './schedule'
import type { CertInfo, KeyStorage, PdfCertEntry, SigInfo, SigningSettings } from './signing'
import type { AddMdKeyInput, ExportCdsignInput, MdKeyEntry, MdSigningPatch, MdVerifyReport, ReceivedCdsign } from './mdsig'
import type { PolicyDoc, PolicyDraft } from './policy'

export type { RepoRules, ReviewAction, ReviewEvent, AppPrefs, DocStyle }

export type RepoState = 'ok' | 'missing' | 'notGit'

export interface RepoEntry {
    name: string
    dir: string
    url?: string
    section?: string
}

export interface AppSettings {
    repos: RepoEntry[]
    current?: string
    author: { name: string; email: string }
    identityDefault?: string
    username: string
    githubClientId?: string
    gitlabHosts?: GitLabHost[]
    gitlabClientId?: string
    theme?: 'light' | 'dark' | 'system'
    prefs: AppPrefs
    mcp?: McpConfig
    ai?: AiConfig
    experiments?: Partial<Record<ExperimentId, boolean>>
    clauseLibrary?: string
    signing?: SigningSettings
    policyPins?: Record<string, { genesis: string; version: number; doc: PolicyDoc }>
}

export interface McpConfig {
    enabled: boolean
    port: number
}

export const DEFAULT_MCP_PORT = 39217

export interface DesktopStatus {
    state: 'notInstalled' | 'unregistered' | 'registered' | 'outdated' | 'broken'
    path: string | null
    error?: string
}

export interface LicenseEntry {
    name: string
    version: string
    license: string
    author?: string
    url?: string
    text?: string
}

export interface LicenseList {
    app: LicenseEntry
    partial: boolean
    packages: LicenseEntry[]
}

export interface AiStatus {
    config: AiConfig
    label: string
    ready: boolean
    reason?: string
    hasKey: boolean
    local: boolean
    mcp: { running: boolean; url: string; error?: string; socket?: string; socketError?: string }
}

export interface AiModel {
    id: string
    label?: string
}

export interface DocChangedEvent {
    dir: string
    path: string
    by: 'ai' | 'mcp'
}

export interface AiRunInput {
    session: string
    path: string
    instruction: string
    selection?: string
}

export type AiEvent =
    | { session: string; type: 'text'; text: string }
    | { session: string; type: 'thinking'; text: string }
    | { session: string; type: 'tool'; label: string }
    | { session: string; type: 'done' }
    | { session: string; type: 'error'; message: string }

export interface DocFile {
    path: string
    title: string
    changed: boolean
}

export interface RepoActivity {
    recent: { oid: string; message: string; author: string; timestamp: number; paths: string[] }[]
    docs: Record<string, { articles: number; author?: string; timestamp?: number }>
    effective: { docPath: string; date: string; oid: string; message: string }[]
}

export interface CommitInfo {
    oid: string
    parents: string[]
    message: string
    author: string
    timestamp: number
    tags: string[]
    branches: string[]
    head?: boolean
    onCurrent?: boolean
    onMain?: boolean
    lines?: string[]
}

export interface BranchInfo {
    name: string
    label: string
    isMain: boolean
    current: boolean
    local: boolean
    remote: boolean
    oid: string
    timestamp: number
    author: string
    changes: number
    mainMoved: boolean
}

export interface MergePreview {
    upToDate: boolean
    files: string[]
    conflicts: Conflict[]
    autoMerged: string[]
    from: string
}

export interface MergeInput {
    from: string
    into: string
    choices: Record<string, ConflictChoice>
    message: string
    effectiveDate?: string
    deleteAfter?: boolean
}

export type SyncState =
    | { state: 'local' }
    | { state: 'upToDate' }
    | { state: 'ahead'; count: number }
    | { state: 'behind' }
    | { state: 'diverged'; conflicts: Conflict[]; autoMerged?: string[]; theirs: string }
    | { state: 'dirty' }
    | { state: 'error'; message: string }

export interface Conflict {
    path: string
    base: string
    ours: string
    theirs: string
    oursDeleted?: boolean
    theirsDeleted?: boolean
}

export type ConflictChoice = 'ours' | 'theirs' | { content: string | null }

export interface SaveVersionInput {
    message: string
    effectiveDate?: string
    docPath?: string
}

export interface EffectiveVersion {
    tag: string
    date: string
    oid: string
    message: string
    author: string
    timestamp: number
}

export type DeliveryItem = 'docPdf' | 'docDocx' | 'cmpPdf' | 'cmpDocx'

export interface DeliverInput {
    docPath: string
    oid: string
    baseOid?: string
    effectiveDate?: string
    to: string
    memo: string
    items: DeliveryItem[]
    publishRelease: boolean
    sign?: boolean
    pin?: string
    certId?: string
}

export interface DeliveryRecord {
    id: string
    docPath: string
    title: string
    client: string
    oid: string
    baseOid?: string
    effectiveDate?: string
    to: string
    memo: string
    items: DeliveryItem[]
    signed?: boolean
    received?: {
        file: string
        at: string
        by: string
        signers: string[]
        kind?: 'pdf' | 'cdsign'
        agreement?: 'none' | 'complete' | 'pending' | 'violated' | 'invalid'
    }[]
    files: string[]
    folder: string
    at: string
    by: string
    releaseUrl?: string
    releaseError?: string
    releaseForge?: ForgeKind
}

export interface ForgeLogin {
    userCode: string
    verificationUri: string
    expiresIn: number
}

export interface UpdateState {
    state: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'error' | 'dev'
    current: string
    version?: string
    notes?: string
    date?: string
    percent?: number
    message?: string
    via?: 'brew'
}

export interface OpenScheduleEvent {
    dir: string
    docPath: string
}

export interface ForgeAccount {
    base: string
    kind: ForgeKind
    label: string
    login: string | null
    name: string | null
    email: string | null
    method: 'app' | 'token' | null
    deviceLogin: boolean
}

export interface Identity {
    name: string
    email: string
    login?: string
    source: ForgeKind | 'manual'
    base?: string
    label: string
}

export interface DocBase {
    dir: string
    docPath: string
}

export interface ExportSign {
    sign?: boolean
    pin?: string
    certId?: string
}

export type ExportRequest =
    | ({ kind: 'doc'; format: 'pdf' | 'docx' | 'html' | 'md'; source: string; name: string; style?: DocStyle } & Partial<DocBase> & ExportSign)
    | ({
          kind: 'compare'
          format: 'pdf' | 'docx'
          oldSource: string
          newSource: string
          title: string
          name: string
          omitUnchanged: boolean
          compareStyle?: 'table' | 'inline'
          style?: DocStyle
      } & Partial<DocBase> &
          ExportSign)

export interface IssueLink {
    oid: string
    at: string
    by?: string
}

export interface Issue {
    n: number
    title: string
    body: string
    state: 'open' | 'closed'
    author?: string
    createdAt: string
    closedAt?: string
    closedBy?: string
    url?: string
    links: IssueLink[]
    source: 'local' | 'github' | 'gitlab'
}

export interface IssueVersion {
    oid: string
    message: string
    at: number
    how: 'link' | 'ref' | 'close'
}

export interface IssueComment {
    id: string
    body: string
    by?: string
    at: string
    kind: 'user' | 'link' | 'close'
    oid?: string
}

export interface IssueDetail extends Issue {
    versions: IssueVersion[]
    drafts: string[]
    comments: IssueComment[]
}

export interface IssuePatch {
    title?: string
    body?: string
    state?: 'open' | 'closed'
}

export interface ProofreadConfig {
    rules?: Partial<Record<string, boolean>>
    joshiAllow?: string[]
    dictionaries?: string[]
    locale?: Locale
}

export interface ProofreadContext {
    dir?: string
    docPath?: string
}

export interface ProofreadIssue {
    from: number
    to: number
    rule: string
    message: string
}

export interface SavedImage {
    path: string
    src: string
}

export interface Api {
    getSettings(): Promise<AppSettings>
    setTheme(theme: 'light' | 'dark' | 'system'): Promise<void>
    platform(): Promise<string>
    listFonts(): Promise<string[]>
    saveSettings(s: AppSettings): Promise<void>
    resetAll(): Promise<void>
    duplicateRepo(dir: string, parent: string, name: string): Promise<string>
    forkRepo(dir: string): Promise<string>
    createSamples(parent: string): Promise<{ name: string; dir: string }[]>
    detectHouritsu(dir: string): Promise<string[]>
    convertHouritsu(dir: string, paths: string[]): Promise<HouritsuConversion>
    hasToken(): Promise<boolean>
    setToken(base: string, token: string): Promise<void>
    pickFolder(): Promise<string | null>
    pickFolders(): Promise<string[]>
    cloneRepo(url: string, dir: string): Promise<void>
    publishRepo(dir: string, url: string): Promise<string>
    changeRemote(dir: string, url: string): Promise<string>
    disconnectRemote(dir: string): Promise<void>
    openRepo(dir: string): Promise<{ ok: boolean; message?: string }>
    repoStatus(dirs: string[]): Promise<Record<string, RepoState>>
    initRepo(dir: string): Promise<void>

    listDocs(dir: string): Promise<DocFile[]>
    readDoc(dir: string, path: string): Promise<string>
    writeDoc(dir: string, path: string, content: string): Promise<void>
    createDoc(dir: string, path: string, title: string, preset?: 'law' | 'contract'): Promise<void>
    moveDoc(dir: string, from: string, toFolder: string): Promise<{ path: string; recorded: boolean }>
    copyDoc(dir: string, path: string): Promise<string>
    copyDocToRepo(dir: string, path: string, destDir: string): Promise<string>
    deleteDoc(dir: string, path: string): Promise<{ recorded: boolean }>
    showDocInFolder(dir: string, path: string): Promise<void>
    repoActivity(dir: string): Promise<RepoActivity>
    scheduleAll(today: string, days?: number): Promise<ScheduleItem[]>
    readRepoNote(dir: string): Promise<string>
    saveRepoNote(dir: string, text: string): Promise<boolean>

    log(dir: string, path?: string, all?: boolean): Promise<CommitInfo[]>
    lastChange(dir: string, path: string): Promise<{ oid: string; message: string; author: string; timestamp: number } | null>
    readAt(dir: string, oid: string, path: string): Promise<string | null>
    saveVersion(dir: string, input: SaveVersionInput): Promise<string>
    discardChanges(dir: string, path: string): Promise<void>

    sync(dir: string): Promise<SyncState>
    push(dir: string): Promise<SyncState>
    resolveConflicts(dir: string, theirs: string, choices: Record<string, ConflictChoice>): Promise<SyncState>

    listBranches(dir: string): Promise<BranchInfo[]>
    createBranch(dir: string, label: string, from?: string): Promise<string>
    switchBranch(dir: string, name: string): Promise<void>
    previewMerge(dir: string, from: string, into: string): Promise<MergePreview>
    mergeBranch(dir: string, input: MergeInput): Promise<SyncState>
    deleteBranch(dir: string, name: string): Promise<void>

    exportFile(req: ExportRequest): Promise<string | null>
    signingStatus(dir?: string): Promise<SigningStatus>
    setSigningPrefs(patch: DeepPartial<SigningSettings>): Promise<SigningSettings>
    generateSigningKey(storage?: KeyStorage): Promise<SigningStatus>
    deleteSigningKey(): Promise<SigningStatus>
    registerSigningKey(base: string): Promise<KeyRegistration>
    testExternalSigning(dir?: string): Promise<ExternalSigningConfig>
    importPdfCert(data: Uint8Array, password: string, label?: string): Promise<PdfCertEntry>
    createSelfSignedCert(opts: { name: string; email?: string; org?: string; years?: number; label?: string }): Promise<PdfCertEntry>
    addMynaCert(label?: string): Promise<PdfCertEntry>
    updatePdfCert(id: string, patch: Pick<PdfCertEntry, 'label' | 'reason' | 'location' | 'contactInfo'>): Promise<SigningSettings>
    removePdfCert(id: string): Promise<SigningSettings>
    setDefaultPdfCert(id: string): Promise<SigningSettings>
    setRepoPdfCert(dir: string, id: string | null): Promise<SigningSettings>
    exportPdfCert(id: string): Promise<string | null>
    setTsaPassword(password: string): Promise<void>
    testTimestamp(): Promise<{ ok: true }>
    mynaStatus(): Promise<MynaStatus>
    verifyCommits(dir: string, oids: string[]): Promise<Record<string, SigInfo>>
    publishSigningKey(dir: string): Promise<void>
    policyStatus(dir: string): Promise<PolicyStatus>
    signLegacyRules(dir: string): Promise<PolicyStatus>
    proposePolicy(dir: string, draft: PolicyDraft): Promise<PolicyStatus>
    cosignPolicy(dir: string, file: string): Promise<PolicyStatus>
    acceptGenesisChange(dir: string): Promise<PolicyStatus>
    forgePublicKeys(dir: string, login: string): Promise<string[]>
    pickReceivedPdf(): Promise<ReceivedPdf | null>
    saveReceivedPdf(input: ReceivedPdfInput): Promise<string | null>
    exportAllowedSigners(dir: string): Promise<string | null>
    verifyMd(dir: string, path: string, text: string): Promise<MdVerifyReport>
    trustMdKey(signer: string, pubkey: string): Promise<void>
    addMdKey(input: AddMdKeyInput): Promise<MdKeyEntry>
    removeMdKey(id: string): Promise<void>
    setMdSigning(patch: MdSigningPatch): Promise<void>
    exportCdsign(input: ExportCdsignInput): Promise<string | null>
    pickCdsign(dir: string, deliveryId: string): Promise<ReceivedCdsign | null>
    saveCdsign(input: { path: string; dir: string; deliveryId: string }): Promise<string | null>
    listSeals(): Promise<SealMeta[]>
    saveSeal(meta: { kind: SealMeta['kind']; label: string }, png: Uint8Array): Promise<SealMeta>
    readSeal(id: string): Promise<Uint8Array>
    deleteSeal(id: string): Promise<void>
    previewPdf(source: string, style: DocStyle, base?: DocBase): Promise<Uint8Array>
    saveImage(dir: string, docPath: string, data: Uint8Array, ext: string): Promise<SavedImage>
    proofread(text: string, ctx?: ProofreadContext): Promise<ProofreadIssue[]>
    setSpellLanguages(langs: string[]): Promise<void>
    systemLanguages(): Promise<string[]>
    listIssues(dir: string): Promise<Issue[]>
    issueDetail(dir: string, n: number): Promise<IssueDetail>
    createIssue(dir: string, input: { title: string; body: string }): Promise<Issue>
    updateIssue(dir: string, n: number, patch: IssuePatch): Promise<Issue>
    linkIssue(dir: string, n: number, oid: string): Promise<void>
    commentIssue(dir: string, n: number, body: string): Promise<void>
    closeIssue(dir: string, n: number, oid?: string): Promise<Issue>
    branchIssues(dir: string, branch: string): Promise<number[]>
    setBranchIssues(dir: string, branch: string, issues: number[]): Promise<void>
    pendingLocalIssues(dir: string): Promise<number>
    moveIssuesToForge(dir: string): Promise<{ moved: number; renumbered: { from: number; to: number }[] }>
    editCommand(cmd: 'cut' | 'copy' | 'paste' | 'selectAll'): Promise<void>

    listEffective(dir: string, docPath: string): Promise<EffectiveVersion[]>
    addEffective(dir: string, docPath: string, oid: string, date: string): Promise<void>
    removeEffective(dir: string, docPath: string, date: string): Promise<void>

    listFolderStyles(dir: string): Promise<StyleLayers>
    saveFolderStyle(dir: string, folder: string, style: StyleOverride): Promise<boolean>
    setZoom(percent: number): Promise<void>
    getRules(dir: string): Promise<RepoRules>
    saveRules(dir: string, rules: RepoRules): Promise<void>
    forgeKind(dir: string): Promise<ForgeKind | null>
    listReviews(dir: string): Promise<ReviewEvent[]>
    addReview(dir: string, input: { branch: string; action: ReviewAction; text: string }): Promise<void>

    occurrences(
        dir: string,
        from: string,
        to: string,
        today: string,
    ): Promise<{ kinds: EventKind[]; events: DueEvent[]; items: Occurrence[]; periods: Period[] }>
    occurrencesAll(from: string, to: string, today: string): Promise<{ repos: RepoSchedule[]; items: ScheduleItem[]; periods: (Period & { dir: string })[] }>
    exportSchedule(dir: string, today: string): Promise<{ path: string; count: number } | null>
    listEvents(dir: string): Promise<DueEvent[]>
    saveEvent(dir: string, input: DueEventInput): Promise<DueEvent>
    deleteEvent(dir: string, id: string): Promise<void>
    setEventDone(dir: string, id: string, date: string, done: boolean): Promise<void>
    getEventKinds(dir: string): Promise<EventKind[]>
    saveEventKinds(dir: string, kinds: EventKind[]): Promise<void>

    listDeliveries(dir: string, docPath?: string): Promise<DeliveryRecord[]>
    deliver(dir: string, input: DeliverInput): Promise<DeliveryRecord | null>
    openPath(path: string): Promise<void>
    openExported(path: string): Promise<void>
    showExported(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    getLicenses(): Promise<LicenseList | null>

    accounts(): Promise<ForgeAccount[]>
    identity(dir: string | null): Promise<Identity | null>
    loginStart(base: string): Promise<ForgeLogin>
    loginWait(base: string): Promise<ForgeAccount>
    logout(base: string): Promise<void>

    aiStatus(): Promise<AiStatus>
    suggestVersionMessage(dir: string): Promise<string>
    setAiKey(provider: AiProvider, key: string, baseUrl?: string): Promise<AiStatus>
    setAiConfig(config: AiConfig): Promise<AiStatus>
    listAiModels(config: AiConfig): Promise<AiModel[]>
    aiLoginOpenRouter(): Promise<AiStatus>
    testAi(): Promise<string>
    getMcpToken(): Promise<string>
    regenerateMcpToken(): Promise<string>
    desktopStatus(): Promise<DesktopStatus>
    registerDesktop(): Promise<DesktopStatus>
    unregisterDesktop(): Promise<DesktopStatus>
    setMcp(config: McpConfig): Promise<AiStatus>
    aiRun(dir: string, input: AiRunInput): Promise<void>
    aiStop(session: string): Promise<void>
    aiReset(session: string): Promise<void>
    onDocChanged(cb: (e: DocChangedEvent) => void): () => void
    onAiEvent(cb: (e: AiEvent) => void): () => void
    onOpenSchedule(cb: (e: OpenScheduleEvent) => void): () => void
    onUpdateState(cb: (e: UpdateState) => void): () => void
    updateState(): Promise<UpdateState>
    checkUpdate(): Promise<UpdateState>
    downloadUpdate(): Promise<UpdateState>
    installUpdate(): Promise<void>
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export interface ExternalSigningConfig {
    format: 'ssh' | 'openpgp' | 'x509'
    key: string
    program: string
}

export interface SigningStatus {
    signing: SigningSettings
    hasKey: boolean
    external: ExternalSigningConfig | null
    myna: boolean
    chip: boolean
    hasTsaPassword: boolean
}

export interface MynaStatus {
    available: boolean
    reader: string | null
    card: boolean
    signCert: boolean
    retries: number | null
    error?: string
}

export interface KeyRegistration {
    ok: boolean
    manualUrl?: string
}

export type { CertInfo, PdfCertEntry, SigInfo }

export interface SealMeta {
    id: string
    kind: 'seal' | 'sign' | 'image'
    label: string
    createdAt: string
}

export interface PolicyWarning {
    kind: 'invalid' | 'unapproved' | 'forked' | 'genesisChanged' | 'rollback' | 'removed'
    version: number
}

export interface PolicyPending {
    file: string
    version: number
    createdAt: string
    createdBy: string
    have: number
    needed: number
    signedByMe: boolean
    draft: PolicyDraft
}

export interface PolicyStatus {
    signed: boolean
    version: number
    genesis: string
    draft: PolicyDraft
    warnings: PolicyWarning[]
    pending: PolicyPending[]
    me: { name: string; login?: string; publicKey?: string; previousKeys: string[]; isAdmin: boolean; isApprover: boolean }
}

export interface ReceivedPdf {
    path: string
    name: string
    signatures: { signer: string; signedAt?: string }[]
}

export interface ReceivedPdfInput {
    path: string
    dir: string
    deliveryId: string
}
