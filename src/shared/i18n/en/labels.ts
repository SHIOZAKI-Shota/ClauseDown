import type { Messages } from '../types'

export const labels: Messages['labels'] = {
    reviewState: {
        none: 'No review request',
        requested: 'Awaiting review',
        approved: 'Approved',
        changes: 'Changes requested',
        outdated: 'Changed after approval',
    },
    reviewBlocked: {
        none: 'This repository requires review and approval before changes go into the current version. Request a review.',
        outdated: 'The draft changed after it was approved. Get it approved again.',
        changes: 'Changes were requested. Make the fixes and request another review.',
        requested: 'Not approved yet',
        partial: (n, need) => `${n} of ${need} approvals. ${need - n} more needed.`,
        unsigned: 'Only unsigned approvals were given. This repository counts signed approvals only.',
    },
    colors: {
        blue: 'Blue',
        sky: 'Sky',
        teal: 'Teal',
        green: 'Green',
        amber: 'Yellow',
        orange: 'Orange',
        red: 'Red',
        pink: 'Pink',
        violet: 'Purple',
        slate: 'Gray',
    },
    kinds: {
        effective: 'Effective',
        promulgate: 'Promulgation',
        submit: 'Submission',
        notify: 'Filing',
        apply: 'Application',
        start: 'Start',
        end: 'End',
        renew: 'Renewal',
        deadline: 'Deadline',
        delivery: 'Delivery',
        fallback: 'Event',
    },
    eventErrors: {
        invalid: 'The due date details are invalid',
        noKind: 'Choose a type',
        badDate: 'The date is invalid',
        badEnd: 'The end date is invalid',
        endBeforeStart: 'The end date must be on or after the start date',
        badRepeat: 'The repeat setting is invalid',
        badUntil: 'The repeat end date is invalid',
        badDoc: 'The document is invalid',
    },
    experiments: {
        clauseLibrary: {
            label: 'Clause library',
            description:
                'Keep frequently used articles in a library repository and add them to documents with Insert. Article references are mapped to articles in the target document when inserting.',
        },
        lanAi: {
            label: 'Connect to Ollama on the LAN',
            description:
                'Allows LAN addresses (such as http://192.168.x.x:11434) for Ollama and OpenAI-compatible endpoints. Documents travel over the LAN unencrypted.',
        },
        houritsuExport: {
            label: 'Export to Markdown (houritsu)',
            description: 'Adds an export menu item for houritsu-format Markdown, with article and paragraph numbers written into the text.',
        },
    },
    aiProviders: {
        anthropic: {
            label: 'Claude (Anthropic)',
            description: "Uses Anthropic's Claude with an API key. Document contents are sent to Anthropic.",
        },
        openai: {
            label: 'OpenAI, Gemini, etc. (OpenAI-compatible)',
            description:
                'Uses any service with an OpenAI-compatible API, such as OpenAI, Google Gemini, DeepSeek, or LM Studio, with a URL and API key. Document contents are sent to that endpoint.',
        },
        ollama: {
            label: 'Ollama (local)',
            description:
                'Uses Ollama running on this computer. No API key is needed, and documents never leave your PC. Requires a model that supports tools (qwen3, llama3.1, gpt-oss, etc.).',
        },
        openrouter: {
            label: 'OpenRouter (sign in with browser)',
            description:
                'Sign in to OpenRouter in your browser (no API key needed). Choose from Claude, GPT, Gemini, and more. You pay OpenRouter. Document contents are sent to OpenRouter and the company behind the chosen model.',
        },
        github: {
            label: 'GitHub Models (GitHub sign-in)',
            description:
                'Uses the GitHub account you signed in with under GitHub/GitLab in Settings. There is a free tier with rate limits. Document contents are sent to GitHub (Microsoft).',
        },
    },
    lmStudioLocal: 'LM Studio (local)',
    openaiCompatible: 'OpenAI-compatible',
    ics: {
        wholeRepo: 'Whole repository',
        repo: (repo) => `Repository: ${repo}`,
        doc: (doc) => `Document: ${doc}`,
        head: (kind, title) => `${kind}: ${title}`,
        summary: (head, repo) => `${head} (${repo})`,
    },
    forgeReview: {
        github: (n) => `GitHub pull request #${n}`,
        gitlab: (n) => `GitLab merge request !${n}`,
    },
    styleSource: {
        app: 'Local settings',
        repo: 'Repository settings',
        folder: (folder) => `"${folder}" settings`,
    },
    mergeWhere: {
        preambleTitle: 'Preamble / title',
        top: 'Start of document',
    },
}
