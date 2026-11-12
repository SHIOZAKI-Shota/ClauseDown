<script setup lang="ts">
const props = withDefaults(
    defineProps<{
        as?: 'button' | 'div'
        icon?: string
        active?: boolean
        dim?: boolean
        disabled?: boolean
    }>(),
    { as: 'button' },
)
defineEmits<{ click: [MouseEvent] }>()
const isButton = computed(() => props.as === 'button')
</script>

<template>
    <component
        :is="as"
        class="cd-list-row"
        :class="{ on: active, off: dim, clickable: isButton }"
        :type="isButton ? 'button' : undefined"
        :disabled="isButton && disabled ? true : undefined"
        @click="(e: MouseEvent) => $emit('click', e)"
    >
        <span v-if="icon || $slots.lead" class="lead">
            <slot name="lead">
                <UIcon :name="icon!" class="ic" />
            </slot>
        </span>
        <span class="main">
            <span class="t">
                <slot />
            </span>
            <span v-if="$slots.sub" class="sub">
                <slot name="sub" />
            </span>
            <slot name="extra" />
        </span>
        <span v-if="$slots.trail" class="trail">
            <slot name="trail" />
        </span>
    </component>
</template>

<style scoped>
.cd-list-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 12px;
    text-align: left;
    min-width: 0;
}

.clickable {
    cursor: pointer;
}

.cd-list-row:hover:not(:disabled) {
    background: var(--ui-bg-elevated);
}

.cd-list-row.on {
    background: var(--cd-selected);
}

.cd-list-row.off {
    opacity: 0.55;
}

.cd-list-row:disabled {
    cursor: default;
}

.lead {
    flex-shrink: 0;
    display: flex;
}

.ic {
    width: 16px;
    height: 16px;
    color: var(--ui-text-muted);
}

.main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
}

.t {
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.sub {
    font-size: 11px;
    color: var(--ui-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.trail {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
}
</style>
