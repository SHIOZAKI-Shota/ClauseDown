import { locale, type Locale } from './i18n'

// AI に渡す文（画面には出ない）。答えの言語をそろえるため、画面の言語で選ぶ
const JA = {
	versionSystem: `あなたは、法令・契約書・規程の改定履歴を書く担当者です。
渡された変更から、版の説明を日本語で 1 行だけ書きます。
- 60 字程度まで。句点は付けない
- 「第12条 契約期間を2年に変更」のように、どの条をどう変えたかを書く
- 変更が多いときは主なものを書き、残りは「ほか」とまとめる
- 新しい文書なら「○○を作成」、消した文書なら「○○を削除」
- 説明の文だけを返す。前置き・引用符・箇条書きの記号は付けない`,
	versionPrompt: (diff: string) => `次の変更の、版の説明を 1 行で書いてください。[-…-] は消した文字、{+…+} は足した文字です。\n\n${diff}`,
	newDoc: '（新しい文書）',
	removedDoc: '（消した文書）',
	truncated: '（以下略）',
	ping: '「接続できました」とだけ答えてください。',
	stopped: '途中で止まったため実行していません',
	badJson: '道具の入力が JSON として読めませんでした。正しい JSON でもう一度呼んでください',
	toolError: (m: string) => `エラー：${m}`,
	openDoc: (repo: string, path: string, branch: string) => `開いている文書：リポジトリ「${repo}」の ${path}（作業中：${branch}）`,
	selection: (s: string) => `エディタで選んでいる部分：\n\`\`\`\n${s}\n\`\`\``,
}

const EN: typeof JA = {
	versionSystem: `You write the revision history of statutes, contracts and internal rules.
From the given changes, write a one-line version message in English.
- About 70 characters at most. No trailing period
- Say which article changed and how, e.g. "Section 12: extend the term to two years"
- If there are many changes, name the main ones and summarize the rest as "and others"
- For a new document write "Create …", for a removed one "Delete …"
- Return only the message. No preamble, quotes or bullet marks`,
	versionPrompt: (diff: string) =>
		`Write a one-line version message for the following changes. [-…-] marks deleted text and {+…+} marks added text.\n\n${diff}`,
	newDoc: ' (new document)',
	removedDoc: ' (deleted document)',
	truncated: '(truncated)',
	ping: 'Reply with just "Connected".',
	stopped: 'Not run because the turn was stopped',
	badJson: 'The tool input was not valid JSON. Call the tool again with valid JSON',
	toolError: (m: string) => `Error: ${m}`,
	openDoc: (repo: string, path: string, branch: string) => `Open document: ${path} in repository "${repo}" (working on: ${branch})`,
	selection: (s: string) => `Selected in the editor:\n\`\`\`\n${s}\n\`\`\``,
}

export const aiPrompts = (l: Locale = locale()) => (l === 'en' ? EN : JA)
