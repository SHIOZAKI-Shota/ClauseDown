import { locale, messagesOf, type Locale } from './i18n'

// AI への指示（system prompt）。本文は i18n の ai.system。回答の言語も画面の言語に合わせる
export const aiSystem = (l: Locale = locale()): string => messagesOf(l).ai.system

// 道具の呼び出しを自分で書かないモデル向けに、system prompt に足す注意
export const aiToolUse = (l: Locale = locale()): string => messagesOf(l).ai.toolUse

// MCP の prompt の引数の説明と、依頼文の前置き
export const aiMcpText = (l: Locale = locale()) => messagesOf(l).ai.mcp

export interface AiPreset {
	id: string
	label: string
	icon: string
	description: string
	prompt: string
}

const PRESET_ICONS = {
	legal_check: 'i-lucide-scale',
	polish: 'i-lucide-pen-line',
	refs: 'i-lucide-link',
	explain: 'i-lucide-message-square-text',
} as const

// AI に頼む定型の依頼。表示・依頼文とも、今の画面の言語で作る
export function aiPresets(l: Locale = locale()): AiPreset[] {
	const p = messagesOf(l).ai.presets
	return (Object.keys(PRESET_ICONS) as (keyof typeof PRESET_ICONS)[]).map((id) => ({ id, icon: PRESET_ICONS[id], ...p[id] }))
}
