import type { View } from '~/stores/app'

export interface GuideMessage {
    type: 'clausedown-guide'
    view: View
    topic: string | null
}

const LABELS: [RegExp, string][] = [
    [/^(条|項|号|細分)$/, 'add'],
    [/^挿入/, 'insert'],
    [/書式設定/, 'config'],
    [/^AI/, 'ai'],
    [/書き出し|^PDF$|^Word$/, 'export'],
    [/版を保存/, 'save'],
    [/^改定履歴/, 'history'],
    [/新旧対照表|前の版と比較|今の文書と比較/, 'compare'],
    [/期日・有効期間・納品/, 'releases'],
    [/期日・有効期間/, 'schedule'],
    [/^課題/, 'issues'],
    [/リポジトリホーム/, 'docs'],
    [/見本に戻す/, 'reset'],
    [/アプリを入手/, 'get'],
    [/リポジトリを切り替える/, 'repos'],
    [/^現行版|作業中の案|^案\//, 'branch'],
    [/文書・目次|左のペイン/, 'outline'],
    [/検索/, 'search'],
    [/誤り|注意/, 'proofread'],
    [/施行日/, 'effective'],
    [/納品/, 'deliver'],
    [/この版に戻す/, 'restore'],
    [/元に戻す|やり直す/, 'undo'],
    [/プレビューの倍率|拡縮/, 'zoom'],
]

const AREAS: [string, string][] = [
    ['.trail-btn', 'trail'],
    ['.cm-lintRange, .cm-tooltip-lint', 'proofread'],
    ['.cm-editor', 'markdown'],
    ['.cd-preview, .print-body', 'preview'],
    ['.ed-docs', 'outline'],
    ['.ed-outline-pane', 'outline'],
    ['.graph', 'graph'],
    ['.tl', 'timeline'],
]

const INTERACTIVE = 'button, a, input, [role="tab"], [role="menuitem"], [role="button"], [role="combobox"]'

function labelOf(el: Element): string {
    return (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ')
}

export function topicOf(target: EventTarget | null): string | null {
    let el = target instanceof Element ? target : null
    for (; el && el !== document.body; el = el.parentElement) {
        if (el.matches(INTERACTIVE)) {
            const label = labelOf(el)
            const hit = LABELS.find(([re]) => re.test(label))
            if (hit) return hit[1]
        }
        const area = AREAS.find(([sel]) => el!.matches(sel))
        if (area) return area[1]
    }
    return null
}

export function startGuide(view: () => View, onView: (fn: () => void) => void) {
    if (window.parent === window) return
    let topic: string | null = null
    let last = ''
    let touched = false
    const send = () => {
        if (!touched) return
        const msg: GuideMessage = { type: 'clausedown-guide', view: view(), topic }
        const key = `${msg.view}:${msg.topic}`
        if (key === last) return
        last = key
        window.parent.postMessage(msg, location.origin)
    }
    const pick = (e: Event) => {
        const t = topicOf(e.target)
        if (t) topic = t
        send()
    }
    const touch = (e: Event) => {
        if (touched) return
        touched = true
        pick(e)
    }
    document.addEventListener('pointermove', touch, { passive: true })
    document.addEventListener('keydown', touch)
    document.addEventListener('pointerover', pick, { passive: true })
    document.addEventListener('focusin', pick)
    onView(() => {
        topic = null
        send()
    })
}
