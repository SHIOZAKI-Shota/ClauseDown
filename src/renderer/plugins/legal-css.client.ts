import { LEGAL_CSS } from '@shared/legal-css'

export default defineNuxtPlugin(() => {
    if (document.getElementById('cd-legal-css')) return
    const el = document.createElement('style')
    el.id = 'cd-legal-css'
    el.textContent = LEGAL_CSS
    document.head.appendChild(el)
})
