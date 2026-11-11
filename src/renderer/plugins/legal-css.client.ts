import { LEGAL_CSS } from '@shared/legal-css'
import { MATH_CSS } from '@shared/math'

export default defineNuxtPlugin(() => {
    if (document.getElementById('cd-legal-css')) return
    const el = document.createElement('style')
    el.id = 'cd-legal-css'
    el.textContent = LEGAL_CSS
    document.head.appendChild(el)
    const math = document.createElement('style')
    math.id = 'cd-math-css'
    math.textContent = MATH_CSS
    document.head.appendChild(math)
})
