<script setup lang="ts">
// input type="date"は空()が出る、多分おま環
import { CalendarDate, parseDate, type DateValue } from '@internationalized/date'

const props = defineProps<{ min?: string; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }>()
const model = defineModel<string>({ default: '' })

const toDate = (s?: string) => {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
    try {
        return parseDate(s)
    } catch {
        return undefined
    }
}
const value = computed<CalendarDate | undefined>({
    get: () => toDate(model.value),
    set: (v) => {
        model.value = v ? v.toString() : ''
    },
})
const minValue = computed(() => toDate(props.min))
const pick = (v: DateValue | undefined) => {
    if (v) value.value = new CalendarDate(v.year, v.month, v.day)
}
</script>

<template>
    <UInputDate v-model="value" :min-value="minValue" :size="size" class="date-field">
        <template #trailing>
            <UPopover :content="{ align: 'end' }">
                <UButton icon="i-lucide-calendar" size="xs" color="neutral" variant="link" square aria-label="カレンダーから選ぶ" />
                <template #content>
                    <UCalendar :model-value="value" :min-value="minValue" class="cal" @update:model-value="(v) => pick(v as DateValue | undefined)" />
                </template>
            </UPopover>
        </template>
    </UInputDate>
</template>

<style scoped>
.date-field {
    width: fit-content;
}

.cal {
    padding: 8px;
}
</style>
