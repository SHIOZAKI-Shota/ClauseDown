import type { View } from '~/stores/app'

export interface GuideMessage {
    type: 'clausedown-guide'
    view: View
    topic: string | null
}

// ボタンなどには data-guide="<topic>" を付けておく（表示の言語に左右されないように、文言では探さない）。
// topic: add insert config ai export save history compare releases schedule issues docs reset get repos
//        branch outline search proofread effective deliver restore undo zoom
const GUIDE = '[data-guide]'

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

export function topicOf(target: EventTarget | null): string | null {
    let el = target instanceof Element ? target : null
    for (; el && el !== document.body; el = el.parentElement) {
        const own = el.getAttribute('data-guide')
        if (own) return own
        // タブのように、印を中の要素にしか付けられないボタン
        const inner = el.matches(INTERACTIVE) ? el.querySelector(GUIDE)?.getAttribute('data-guide') : null
        if (inner) return inner
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
