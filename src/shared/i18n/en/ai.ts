import type { Messages } from '../types'

export const ai: Messages['ai'] = {
	system: `You are an assistant that helps draft, edit and review documents made up of articles, such as bills, ordinances, contracts, terms and internal rules. Documents are written in ClauseDown Markdown.

## Document syntax
- \`# Document title\`, \`## Chapter\`, \`### Article heading {#name}\`, \`- Paragraph\`, \`  - Item\`, \`    - Sub-item\`
- Article, paragraph and item numbers are assigned automatically. Do not write numbers such as "Article 3", "2" or "(i)" into the Markdown. The numbers in 〔〕 returned by read_doc are computed
- Cross-references are written \`[[name]]\` (\`[[name:2]]\` to point to a paragraph). The heading of the referenced article needs \`{#name}\`. Reference numbers stay correct automatically when articles are added or removed
- \`### Heading {branch}\` is a branch-numbered article, \`### {deleted}\` a deleted article, \`## Supplementary Provisions {supplement}\` the supplementary provisions, \`## {closing}\` the closing text and signature block, and \`## Appended Table 1 {appendix}\` an appended table
- Tables and \`\`\`mermaid diagrams indented under a paragraph or item belong to that paragraph or item
- The \`<!-- clausedown ... -->\` block at the top holds the format settings. Do not change it unless asked
- When the drafting style (\`doc: { style: … }\`) is not Japanese, numbers and cross-references follow foreign conventions such as "Section 3.2(a)" or "§ 3 Absatz 2". You still never write numbers into the Markdown. Cross-references can continue down to paragraph, item and sub-item, as in \`[[name:2:1]]\`

## When editing
- Change only what you were asked to, with small replacements using edit_doc
- Saving versions, applying changes to the current version, effective dates and deliveries are done by people. You only change the working folder
- When you are done, briefly report which articles you changed and how
- If the instruction is ambiguous and needs a decision that would change the meaning of the document, ask before editing

## When doing a legal review
- Read the whole document with read_doc, and also use check_doc
- List findings in article order, each as "Location (Article X(Y)) / Severity (high/medium/low) / Issue / Basis (statute and article; "needs verification" if unsure) / Suggested fix (draft wording)"
- Your knowledge only goes up to a certain date. For areas that are amended often, and for figures, periods and deadlines set by law, add "Please check against the latest laws and official guidance"
- Do not state as certain what you cannot be sure of, and say clearly where an expert's judgment is needed
- If you were only asked to review, do not edit the document

Answer in English, concisely.`,
	toolUse: `

## Using tools
- Never guess what the document says; always read it with tools such as read_doc before answering
- To change the document, call tools such as edit_doc instead of writing the revised document in your reply`,
	presets: {
		legal_check: {
			label: 'Legal review',
			description: 'Points out conflicts with the law, gaps and vague wording, article by article (does not edit the document)',
			prompt: 'Please do a legal review of this document.',
		},
		polish: {
			label: 'Polish wording',
			description: 'Makes the wording consistent with legal drafting style without changing the meaning',
			prompt: 'Without changing the meaning, polish the wording to follow legal drafting conventions (consistent conjunctions, consistent terms, and so on).',
		},
		refs: {
			label: 'Fix cross-references',
			description: 'Replaces article numbers typed into the text with cross-references that stay numbered correctly',
			prompt: 'Find places in the text where article numbers are written out directly (such as "Article 5" or "the preceding article") and turn the ones that should be cross-references ([[name]]) into cross-references.',
		},
		explain: {
			label: 'Explain the changes',
			description: 'Summarizes the changes from the current version as an explanation for the people involved',
			prompt: 'Use compare_versions to find the changes from the current version, and write an explanation of the amendments for the client and others involved (do not edit the document).',
		},
	},
	mcp: {
		repoArg: 'Repository name',
		pathArg: 'Document path',
		about: (repo, path) => `About ${path} in the repository "${repo}".`,
	},
	settings: {
		ollamaLan: 'Uses Ollama on your local network. No API key is needed. You need a model that supports tools (qwen3, llama3.1, gpt-oss and so on).',
		otherUrl: 'Other (enter a URL)',
		modelItem: (label, id) => `${label} (${id})`,
		keyCleared: 'Key removed',
		keySaved: 'Key saved',
		openRouterSignedIn: 'Signed in to OpenRouter',
		reply: (text) => `AI reply: ${text}`,
		provider: 'AI provider',
		endpoint: 'Endpoint',
		endpointDesc: 'For Gemini, use a key from Google AI Studio. For DeepSeek, use a key from the DeepSeek website.',
		ollamaUrl: 'Ollama address',
		ollamaUrlDesc: 'Leave blank to use http://127.0.0.1:11434. Usually you can leave it blank.',
		claudeKey: 'Claude API key',
		apiKey: 'API key',
		keyStored: 'Saved (encrypted on this computer). This key is only sent to this endpoint.',
		keyAnthropic: 'Enter a key created in the Anthropic Console.',
		keyOther: 'Enter a key issued by that endpoint.',
		overwrite: 'Type to replace',
		clearKey: 'Remove',
		clearKeyConfirm: 'Remove the API key?',
		clearKeyDesc: 'This AI cannot be used until you enter a key again.',
		openRouterAccount: 'OpenRouter account',
		openRouterStored: 'Signed in (the key received is encrypted on this computer).',
		openRouterHint: 'Sign in to OpenRouter in your browser to get a key for this app.',
		logout: 'Sign out',
		openRouterLogin: 'Sign in with OpenRouter',
		githubAccount: 'GitHub account',
		githubUses: (login) => `Uses the sign-in for ${login}.`,
		githubNeeded: 'Sign in to GitHub under "GitHub/GitLab" in Settings.',
		openLogin: 'Open sign-in settings',
		model: 'Model',
		modelOllamaDesc: 'Choose from installed models (install one with, for example, ollama pull qwen3). The model must support tool calling.',
		modelDesc: 'Choose from the list or type a name. Leave blank to use the default model.',
		pickFromList: 'Choose from list',
		modelName: 'Model name',
		refreshList: 'Refresh list',
		status: 'Status',
		using: (label) => `Using ${label}.`,
		local: 'Documents stay on this computer',
		notReady: 'Not ready yet',
		test: 'Test connection',
	},
	panel: {
		local: 'Documents stay on this computer. ',
		sendTo: {
			anthropic: 'the Anthropic Claude API',
			openai: 'the endpoint you set up',
			ollama: 'Ollama',
			openrouter: 'OpenRouter and the company behind the chosen model',
			github: 'GitHub Models',
		},
		sentTo: (to) => `The document's contents are sent to ${to}. `,
		aboutSelection: '(about the selected text)',
		runningLocal: 'Running on this computer (documents stay on this computer)',
		changeInSettings: 'You can change this under "AI" in Settings',
		newChat: 'New conversation',
		setup: 'To use AI, set up a provider under "AI" in Settings.',
		openSettings: 'Open Settings',
		lead: 'Ask the AI for help with this document.',
		thinkingNow: 'Thinking…',
		thought: 'Thoughts',
		thinking: 'Thinking…',
		changed: 'The AI changed the document. No version has been saved yet.',
		revert: 'Undo the AI changes',
		placeholder: 'For example: change the probation period in Article 5 to 2 months and add a provision for extending it',
		useSelection: 'Include the selected text',
		stop: 'Stop',
		send: 'Send',
		sendKey: (keys) => `${keys} to send`,
	},
}
