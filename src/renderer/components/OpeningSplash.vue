<script setup lang="ts">
import lottie, { type AnimationItem } from 'lottie-web/build/player/lottie_light'
import data from '~/assets/anim/opening.json'

const SPEED = 3

const emit = defineEmits<{ done: [] }>()
const box = ref<HTMLElement>()
const leaving = ref(false)
let anim: AnimationItem | null = null

function finish() {
    if (leaving.value) return
    leaving.value = true
    setTimeout(() => emit('done'), 250)
}

onMounted(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return emit('done')
    anim = lottie.loadAnimation({
        container: box.value!,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: data,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    anim.setSpeed(SPEED)
    anim.addEventListener('complete', finish)
    window.addEventListener('keydown', finish, { once: true })
})

onBeforeUnmount(() => {
    anim?.destroy()
    window.removeEventListener('keydown', finish)
})
</script>

<template>
    <div class="splash" :class="{ leaving }" role="presentation" @click="finish">
        <div ref="box" class="anim cd-splash-anim" />
    </div>
</template>

<style scoped>
.splash {
    position: fixed;
    inset: 40px 0 0 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: var(--ui-bg);
    cursor: pointer;
    transition: opacity 0.25s ease;
}

.splash.leaving {
    opacity: 0;
}

.anim {
    width: max(25%, 280px);
    aspect-ratio: 16 / 9;
}
</style>

<style>
.dark .cd-splash-anim path[fill^='rgb'] {
    fill: var(--ui-color-primary-400);
}

.dark .cd-splash-anim path[stroke^='rgb'] {
    stroke: var(--ui-color-primary-400);
}
</style>
