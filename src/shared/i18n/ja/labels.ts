export const labels = {
    reviewState: {
        none: '確認依頼なし',
        requested: '確認待ち',
        approved: '承認済み',
        changes: '修正依頼あり',
        outdated: '承認後に変更あり',
    },
    reviewBlocked: {
        none: 'このリポジトリでは、現行版に反映する前に確認と承認が必要です。「確認を依頼」してください',
        outdated: '承認したあとで改定案が変更されています。もう一度承認を受けてください',
        changes: '修正の依頼が出ています。直して再度確認を依頼してください',
        requested: 'まだ承認されていません',
        partial: (n: number, need: number) => `承認は ${n}／${need} 人です。あと ${need - n} 人の承認が必要です`,
        unsigned: '署名のない承認しかありません。このリポジトリでは、署名済みの承認のみを有効とします',
    },
    colors: {
        blue: '青',
        sky: '空',
        teal: '青緑',
        green: '緑',
        amber: '黄',
        orange: '橙',
        red: '赤',
        pink: '桃',
        violet: '紫',
        slate: '灰',
    },
    kinds: {
        effective: '施行',
        promulgate: '公布',
        submit: '提出',
        notify: '届出',
        apply: '申請',
        start: '開始',
        end: '終了',
        renew: '更新',
        deadline: '期限',
        delivery: '納品',
        fallback: '予定',
    },
    eventErrors: {
        invalid: '期日の内容が正しくありません',
        noKind: '種類を選んでください',
        badDate: '日付が正しくありません',
        badEnd: '終了日が正しくありません',
        endBeforeStart: '終了日は開始日以降にしてください',
        badRepeat: '繰り返しが正しくありません',
        badUntil: '繰り返しの終わりが正しくありません',
        badDoc: '文書の指定が正しくありません',
    },
    experiments: {
        clauseLibrary: {
            label: '条項ライブラリ',
            description: 'よく使う条をライブラリ用のリポジトリにまとめておき、「挿入」から文書に入れます。条参照は挿入するときに、入れる先の条に対応づけます。',
        },
        lanAi: {
            label: 'LAN内 の Ollama に接続する',
            description:
                'Ollama と OpenAI 互換の接続先に、LAN 内のアドレス（http://192.168.x.x:11434 など）を使えるようにします。文書は暗号化されずに LAN を通ります。',
        },
        houritsuExport: {
            label: 'Markdown（houritsu）に書き出す',
            description: '書き出しのメニューに、条番号・項番号を本文に書き込んだ houritsu の形式の Markdown に書き出す項目を出します。',
        },
        cdsign: {
            label: 'Markdown のまま署名をもらう（.cdsign）',
            description:
                'md-signature で文書に署名し、ClauseDown 署名依頼（.cdsign）を書き出します。相手は ClauseDown Sign で連署し、返されたファイルを取り込みます。署名検証のペインと、署名済みの文書の編集の制限も有効になります。',
        },
    },
    aiProviders: {
        anthropic: {
            label: 'Claude（Anthropic）',
            description: 'Anthropic の Claude を API キーで使用します。文書の内容は Anthropic に送られます。',
        },
        openai: {
            label: 'OpenAI・Gemini など（OpenAI 互換）',
            description:
                'OpenAI、Google Gemini、DeepSeek、LM Studio など、OpenAI 互換の API を持つサービスを、URL と API キーを指定して使用します。文書の内容はその接続先に送られます。',
        },
        ollama: {
            label: 'Ollama（この PC の中）',
            description:
                'この PC で動いている Ollama を使用します。API キーは不要で、文書は PC の外に送られません。道具（tools）に対応したモデル（qwen3、llama3.1、gpt-oss など）が必要です。',
        },
        openrouter: {
            label: 'OpenRouter（ブラウザでログイン）',
            description:
                'OpenRouter にブラウザでログインして使用します（API キーの入力は不要です）。Claude・GPT・Gemini などを選べます。料金は OpenRouter に支払います。文書の内容は OpenRouter と、選んだモデルの会社に送られます。',
        },
        github: {
            label: 'GitHub Models（GitHub のログイン）',
            description:
                '設定の「GitHub/GitLab」でログインした GitHub アカウントで使用します。無料枠があり、回数に制限があります。文書の内容は GitHub（Microsoft）に送られます。',
        },
    },
    lmStudioLocal: 'LM Studio（ローカル）',
    openaiCompatible: 'OpenAI 互換',
    ics: {
        wholeRepo: 'リポジトリ全体',
        repo: (repo: string) => `リポジトリ：${repo}`,
        doc: (doc: string) => `文書：${doc}`,
        head: (kind: string, title: string) => `${kind}：${title}`,
        summary: (head: string, repo: string) => `${head}（${repo}）`,
    },
    forgeReview: {
        github: (n: number) => `GitHub のプルリクエスト #${n}`,
        gitlab: (n: number) => `GitLab のマージリクエスト !${n}`,
    },
    styleSource: {
        app: 'この PC の設定',
        repo: 'リポジトリの設定',
        folder: (folder: string) => `「${folder}」の設定`,
    },
    mergeWhere: {
        preambleTitle: '前文・題名',
        top: '文書の先頭',
    },
}
