export const ai = {
    system: `あなたは、法律案・条例・契約書・規約・規程など、条文でできた文書の作成・編集・チェックを手伝う補助者です。文書は ClauseDown の Markdown で書かれています。

## 文書の書き方
- \`# 文書名\`、\`## 章\`、\`### 条の見出し {#名前}\`、\`- 項\`、\`  - 号\`、\`    - 号の細分\`
- 条・項・号の番号は自動で振られます。md に「第3条」「２」「一」と書き込まないでください。read_doc の〔〕は計算した番号です
- 条参照は \`[[名前]]\`（項まで指すときは \`[[名前:2]]\`）。参照先の条の見出しに \`{#名前}\` が要ります。条を足したり消したりしても参照の番号は自動で合います
- \`### 見出し {branch}\` は枝番号の条、\`### {deleted}\` は削除された条、\`## 附則 {supplement}\` は附則、\`## {closing}\` は後文・署名欄、\`## 別表第一 {appendix}\` は別表
- 項・号の下に字下げして書いた表や \`\`\`mermaid の図は、その項・号に付きます
- 先頭の \`<!-- clausedown ... -->\` は書式設定です。頼まれない限り変えないでください
- 書式の系統（\`doc: { style: … }\`）が日本以外のとき、番号と条参照は「Section 3.2(a)」「§ 3 Absatz 2」のような海外の書き方になります。md に番号を書き込まないのは同じです。条参照は \`[[名前:2:1]]\` のように項・号・細分まで続けて書けます

## 編集するとき
- 頼まれた範囲だけを、edit_doc で小さく置き換えてください
- 版の保存・現行版への反映・施行日・納品は人が行います。あなたは作業フォルダを書き換えるだけです
- 書き換えたら、最後にどの条をどう変えたかを短く報告してください
- 指示があいまいで、文書の意味が変わる判断が要るときは、書き換える前に確認してください

## リーガルチェックのとき
- read_doc で全文を読み、check_doc も使ってください
- 指摘は条の順に、1件ごとに「該当箇所（第○条第○項）／重要度（高・中・低）／問題点／根拠（法令名と条文。確かでなければ「要確認」）／修正案（文案）」で書いてください
- あなたの知識はある時点までのものです。改正が多い分野や、法令で決まる数値・期間・期限は「最新の法令・通達で確認してください」と添えてください
- 断定できないことは断定せず、専門家の判断が要る点ははっきり書いてください
- チェックを頼まれただけのときは、文書を書き換えないでください

回答は日本語で、簡潔に書いてください。`,
    toolUse: `

## 道具の使い方
- 文書の中身は推測せず、必ず read_doc などの道具で読んでから答えてください
- 文書を書き換えるときは、本文に書き換え後の文書を書かずに、edit_doc などの道具を呼んでください`,
    presets: {
        legal_check: {
            label: 'リーガルチェック',
            description: '法令との食い違い・抜け・あいまいな表現を条ごとに指摘します（文書は書き換えません）',
            prompt: 'この文書をリーガルチェックしてください。',
        },
        polish: {
            label: '文言を整える',
            description: '意味を変えずに、法令文の書き方に合わせて表現をそろえます',
            prompt: '意味を変えずに、法令文の書き方（「及び」「並びに」「又は」「若しくは」の使い分け、用語の統一など）に合わせて文言を整えてください。',
        },
        refs: {
            label: '条参照を直す',
            description: '本文に直接書いた「第○条」を、番号が自動で合う条参照に置き換えます',
            prompt: '本文中で「第○条」「前条」などと番号を直接書いている箇所のうち、条参照（[[名前]]）にしたほうがよいものを直してください。',
        },
        explain: {
            label: '改定内容の説明',
            description: '現行版と比べた変更点を、関係者向けの説明文にまとめます',
            prompt: '現行版と比べた変更点を compare_versions で調べ、依頼主・関係者に改定内容を説明する文章を作ってください（文書は書き換えないでください）。',
        },
    },
    mcp: {
        repoArg: 'リポジトリの名前',
        pathArg: '文書のパス',
        about: (repo: string, path: string) => `リポジトリ「${repo}」の ${path} について。`,
    },
    settings: {
        ollamaLan: 'LAN 内 の Ollama を使用します。API キーは不要です。道具（tools）に対応したモデル（qwen3、llama3.1、gpt-oss など）が必要です。',
        otherUrl: 'その他（URL を入力）',
        modelItem: (label: string, id: string) => `${label}（${id}）`,
        keyCleared: 'キーを消しました',
        keySaved: 'キーを保存しました',
        openRouterSignedIn: 'OpenRouter にログインしました',
        reply: (text: string) => `AI の応答：${text}`,
        provider: '使う AI',
        endpoint: '接続先',
        endpointDesc: 'Gemini は Google AI Studio、DeepSeek は DeepSeek のサイトで発行したキーを使用します。',
        ollamaUrl: 'Ollama の場所',
        ollamaUrlDesc: '空欄なら http://127.0.0.1:11434 を使います。ふつうは空欄のままで構いません。',
        claudeKey: 'Claude API キー',
        apiKey: 'API キー',
        keyStored: '保存してあります（この PC の中で暗号化しています）。このキーは、この接続先にだけ送ります。',
        keyAnthropic: 'Anthropic の Console で発行したキーを入力してください。',
        keyOther: 'その接続先で発行したキーを入力してください。',
        overwrite: '入力すると上書きします',
        clearKey: '消す',
        clearKeyConfirm: 'API キーを消しますか？',
        clearKeyDesc: 'もう一度入力するまで、この AI は使用できません。',
        openRouterAccount: 'OpenRouter のアカウント',
        openRouterStored: 'ログインしてあります（受け取ったキーを、この PC の中で暗号化しています）。',
        openRouterHint: 'ブラウザで OpenRouter にログインすると、このアプリ用のキーが発行されます。',
        logout: 'ログアウト',
        openRouterLogin: 'OpenRouter でログイン',
        githubAccount: 'GitHub のアカウント',
        githubUses: (login: string) => `${login} のログインを使用します。`,
        githubNeeded: '設定の「GitHub/GitLab」で GitHub にログインしてください。',
        openLogin: 'ログインの設定を開く',
        model: 'モデル',
        modelOllamaDesc: 'インストール済みのモデルから選びます（インストールは ollama pull qwen3 など）。ツール呼び出し（tools）に対応したモデルが必要です。',
        modelDesc: '一覧から選ぶか、名前を直接入力します。空欄なら既定のモデルを使用します。',
        pickFromList: '一覧から選ぶ',
        modelName: 'モデル名',
        refreshList: '一覧を更新',
        status: '状態',
        using: (label: string) => `${label} を使用します。`,
        local: '文書を PC の外に送信しません',
        notReady: 'まだ使えません',
        test: '接続を試す',
    },
    panel: {
        local: '文書を PC の外に送信しません。',
        sendTo: {
            anthropic: 'Anthropic の Claude API',
            openai: '設定した接続先',
            ollama: 'Ollama',
            openrouter: 'OpenRouter と、選んだモデルの会社',
            github: 'GitHub Models',
        },
        sentTo: (to: string) => `文書の内容は ${to} に送信されます。`,
        aboutSelection: '（選んでいる部分について）',
        runningLocal: 'この PC の中で動いています（文書を PC の外に送信しません）',
        changeInSettings: '設定の「AI」で変えられます',
        newChat: '新しい会話',
        setup: 'AI を使うには、設定の「AI」で接続先を設定してください。',
        openSettings: '設定を開く',
        lead: 'この文書について、AI に頼めます。',
        thinkingNow: '思考中…',
        thought: '思考',
        thinking: '考えています…',
        changed: 'AI が文書を書き換えました。版はまだ保存していません。',
        revert: '依頼の前に戻す',
        placeholder: '例：第5条の試用期間を2か月にして、延長の規定も足して',
        useSelection: '選んでいる部分を伝える',
        stop: '止める',
        send: '頼む',
        sendKey: (keys: string) => `${keys} で送信`,
    },
}
