;(() => {
    const root = document.documentElement
    const body = document.body
    const ROOT = body.dataset.root || './'
    const LANG = body.dataset.lang || 'ja'

    const themeBtn = document.getElementById('theme')
    const media = matchMedia('(prefers-color-scheme: dark)')
    const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : media.matches)
    const renderTheme = () => {
        const dark = isDark()
        root.toggleAttribute('data-dark', dark)
        const label = dark ? themeBtn.dataset.lightLabel : themeBtn.dataset.darkLabel
        themeBtn.setAttribute('aria-label', label)
        themeBtn.title = label
    }
    themeBtn.addEventListener('click', () => {
        root.dataset.theme = isDark() ? 'light' : 'dark'
        try {
            localStorage.setItem('clausedown-site-theme', root.dataset.theme)
        } catch {}
        renderTheme()
    })
    media.addEventListener('change', renderTheme)
    renderTheme()

    const side = document.getElementById('side')
    const menuBtn = document.querySelector('.menu-btn')
    const setMenu = (open) => {
        side.classList.toggle('is-open', open)
        menuBtn.setAttribute('aria-expanded', String(open))
    }
    menuBtn.addEventListener('click', () => setMenu(!side.classList.contains('is-open')))
    document.addEventListener('pointerdown', (e) => {
        if (side.classList.contains('is-open') && !e.target.closest('#side') && !e.target.closest('.menu-btn')) setMenu(false)
    })
    const current = side.querySelector('li [aria-current="page"]')
    if (current) side.scrollTop = Math.max(0, current.offsetTop - side.clientHeight / 2)

    const tocLinks = [...document.querySelectorAll('.toc a')]
    if (tocLinks.length) {
        const targets = tocLinks.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean)
        const mark = () => {
            const y = window.scrollY + 120
            let cur = 0
            targets.forEach((t, i) => {
                if (t.offsetTop <= y) cur = i
            })
            tocLinks.forEach((a, i) => a.classList.toggle('is-active', i === cur))
        }
        window.addEventListener('scroll', mark, { passive: true })
        mark()
    }

    const input = document.getElementById('q')
    const hits = document.getElementById('hits')
    let index = null
    let loading = null
    let selected = -1
    const norm = (s) => s.normalize('NFKC').toLowerCase()
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const load = () =>
        (loading ??= fetch(`${ROOT}docs/${LANG === 'en' ? 'en/' : ''}search.json`)
            .then((r) => r.json())
            .then((list) => (index = list.map((e) => ({ ...e, nt: norm(e.t), nx: norm(e.x), nc: norm(e.c) })))))
    const highlight = (text, words) => {
        let out = esc(text)
        for (const w of words) if (w) out = out.replace(new RegExp(esc(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`)
        return out
    }
    const snippet = (e, words) => {
        const at = Math.max(0, e.nx.indexOf(words[0] ?? ''))
        const start = Math.max(0, at - 30)
        return (start ? '…' : '') + e.x.slice(start, start + 120) + (start + 120 < e.x.length ? '…' : '')
    }
    const search = () => {
        const q = norm(input.value.trim())
        if (!q || !index) {
            hits.hidden = true
            hits.innerHTML = ''
            return
        }
        const words = q.split(/\s+/).filter(Boolean)
        const scored = []
        for (const e of index) {
            let score = 0
            let ok = true
            for (const w of words) {
                const inT = e.nt.includes(w)
                const inX = e.nx.includes(w) || e.nc.includes(w)
                if (!inT && !inX) {
                    ok = false
                    break
                }
                score += inT ? 10 : 1
            }
            if (ok) scored.push({ e, score })
        }
        scored.sort((a, b) => b.score - a.score)
        const top = scored.slice(0, 12)
        selected = top.length ? 0 : -1
        hits.innerHTML = top.length
            ? top
                  .map(
                      ({ e }, i) =>
                          `<a role="option" href="${ROOT}${e.u}" aria-selected="${i === 0}"><span class="hc">${esc(e.c)}</span><span class="ht">${highlight(e.t, words)}</span><span class="hx">${highlight(snippet(e, words), words)}</span></a>`,
                  )
                  .join('')
            : `<div class="none">${esc(hits.dataset.empty)}</div>`
        hits.hidden = false
    }
    const move = (d) => {
        const items = [...hits.querySelectorAll('a')]
        if (!items.length) return
        selected = (selected + d + items.length) % items.length
        items.forEach((a, i) => a.setAttribute('aria-selected', String(i === selected)))
        items[selected].scrollIntoView({ block: 'nearest' })
    }
    input.addEventListener('focus', () => load().then(search))
    input.addEventListener('input', () => (index ? search() : load().then(search)))
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            move(e.key === 'ArrowDown' ? 1 : -1)
        } else if (e.key === 'Enter') {
            const a = hits.querySelectorAll('a')[selected]
            if (a) location.href = a.href
        } else if (e.key === 'Escape') {
            hits.hidden = true
            input.blur()
        }
    })
    document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.search')) hits.hidden = true
    })
    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
        if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
            e.preventDefault()
            input.focus()
            input.select()
        }
    })
})()
