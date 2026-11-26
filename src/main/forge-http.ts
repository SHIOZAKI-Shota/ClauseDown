import { t } from '../shared/i18n'
import { isPrNumber } from '../shared/review'
import type { OAuthResponse } from './settings'
import { GITHUB_BASE } from '../shared/forge'
import { sleep } from './util'

export const githubWeb = () => process.env.CLAUSEDOWN_GITHUB_WEB ?? GITHUB_BASE
export const githubApi = () => process.env.CLAUSEDOWN_GITHUB_API ?? 'https://api.github.com'
export const gitlabWeb = (base: string) => process.env.CLAUSEDOWN_GITLAB_WEB ?? base
export const gitlabApi = (base: string) => process.env.CLAUSEDOWN_GITLAB_API ?? `${base}/api/v4`

export async function oauthPost(url: string, body: Record<string, string>, form: boolean): Promise<{ ok: boolean; json: OAuthResponse }> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
		body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
	})
	return { ok: res.ok, json: (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as OAuthResponse }
}

export const oauthWhy = (j: OAuthResponse) => String(j.error_description ?? j.error ?? t().errors.oauth.unknown)

export interface DeviceFlow {
	deviceCode: string
	interval: number
	expiresAt: number
	clientId: string
}

export function deviceFlow(j: OAuthResponse, clientId: string, defaultExpiry: number): DeviceFlow {
	return {
		deviceCode: String(j.device_code),
		interval: Number(j.interval ?? 5),
		expiresAt: Date.now() + Number(j.expires_in ?? defaultExpiry) * 1000,
		clientId,
	}
}

export async function pollDeviceToken(
	flow: DeviceFlow,
	o: {
		request: () => Promise<OAuthResponse>
		alive: () => boolean
		errors: { denied: string; expired: string; failed: (why: string) => string }
	},
): Promise<OAuthResponse> {
	let interval = flow.interval
	while (Date.now() < flow.expiresAt) {
		await sleep(interval * 1000)
		if (!o.alive()) throw new Error(t().errors.oauth.cancelled)
		const j = await o.request()
		if (j.access_token) return j
		if (j.error === 'authorization_pending') continue
		if (j.error === 'slow_down') {
			interval = Math.max(Number(j.interval) || 0, interval + 5)
			continue
		}
		if (j.error === 'access_denied') throw new Error(o.errors.denied)
		if (j.error === 'expired_token') break
		throw new Error(o.errors.failed(oauthWhy(j)))
	}
	throw new Error(o.errors.expired)
}

export class ForgeHttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message)
	}
}

export function prNumber(v: unknown): number {
	if (!isPrNumber(v)) throw new Error(t().errors.github.badNumber)
	return v
}

export async function paginate<T>(fetchPage: (page: number) => Promise<T[]>, maxPages: number): Promise<T[]> {
	const out: T[] = []
	for (let page = 1; page <= maxPages; page++) {
		const list = await fetchPage(page)
		out.push(...list)
		if (list.length < 100) break
	}
	return out
}
