<script setup lang="ts">
const { data, loaded } = useLicenses()
const q = ref('')
const t = useT()

const list = computed(() => {
    const s = q.value.trim().toLowerCase()
    const all = data.value?.packages ?? []
    return s ? all.filter((p) => `${p.name} ${p.license} ${p.author ?? ''}`.toLowerCase().includes(s)) : all
})

const kinds = computed(() => {
    const m = new Map<string, number>()
    for (const p of data.value?.packages ?? []) m.set(p.license, (m.get(p.license) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
})

const open = (url: string) => window.api.openExternal(url)
</script>

<template>
    <div class="licenses">
        <div class="part">
            <h3>{{ t.shell.licenses.appLicense }}</h3>
            <p class="cd-muted">{{ t.shell.licenses.publishedUnder(data?.app.license ?? 'MIT') }}</p>
            <pre v-if="data" class="text">{{ data.app.text }}</pre>
        </div>

        <div class="part">
            <h3>{{ t.shell.licenses.reference }}</h3>
            <p class="cd-muted">
                {{ t.shell.licenses.houritsuBefore }}<a href="#" class="link" @click.prevent="open('https://github.com/Kohei-Wada/houritsu')">houritsu</a
                >{{ t.shell.licenses.houritsuAfter }}
            </p>
        </div>

        <div class="part">
            <div class="row">
                <h3>{{ t.shell.licenses.thirdParty }}</h3>
                <span v-if="data" class="cd-muted">{{ t.shell.licenses.count(data.packages.length) }}</span>
                <span class="cd-grow" />
                <UInput v-if="data" v-model="q" icon="i-lucide-search" size="sm" :placeholder="t.shell.licenses.search" />
            </div>
            <p class="cd-muted">{{ t.shell.licenses.thanks }}</p>

            <p v-if="loaded && !data" class="cd-muted">
                {{ t.shell.licenses.notBuiltBefore }}<code>npm run build</code>{{ t.shell.licenses.notBuiltOr }}<code>npm run licenses</code
                >{{ t.shell.licenses.notBuiltAfter }}
            </p>
            <UAlert v-if="data?.partial" color="warning" variant="subtle" icon="i-lucide-info" :description="t.shell.licenses.partial" />

            <div v-if="kinds.length" class="kinds">
                <UBadge v-for="[k, n] in kinds" :key="k" :label="`${k}　${n}`" color="neutral" variant="subtle" class="kind" @click="q = k" />
            </div>

            <details v-for="p in list" :key="p.name + '@' + p.version" class="pkg">
                <summary>
                    <UIcon name="i-lucide-chevron-right" class="chev" />
                    <span class="name">{{ p.name }}</span>
                    <span class="cd-muted">{{ p.version }}</span>
                    <span class="cd-grow" />
                    <UBadge :label="p.license" color="neutral" variant="outline" size="sm" />
                </summary>
                <div class="body">
                    <p v-if="p.author" class="cd-muted">{{ t.shell.licenses.author(p.author) }}</p>
                    <UButton
                        v-if="p.url"
                        :label="p.url"
                        icon="i-lucide-external-link"
                        size="xs"
                        color="neutral"
                        variant="link"
                        class="url"
                        @click="open(p.url)"
                    />
                    <pre v-if="p.text" class="text">{{ p.text }}</pre>
                    <p v-else class="cd-muted">{{ t.shell.licenses.noFile(p.license) }}</p>
                </div>
            </details>
            <p v-if="data && !list.length" class="cd-muted">{{ t.common.notFound }}</p>
        </div>
    </div>
</template>

<style scoped>
.part {
    margin-top: 16px;
}

h3 {
    font-weight: 700;
    margin: 0 0 6px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}

.row h3 {
    margin: 0;
}

.cd-muted {
    font-size: 13px;
}

.text {
    margin: 8px 0 0;
    padding: 10px 12px;
    max-height: 320px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    background: var(--ui-bg-elevated);
}

.kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 12px 0;
}

.kind {
    cursor: pointer;
}

.pkg {
    border-bottom: 1px solid var(--ui-border);
}

.pkg summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    cursor: pointer;
    list-style: none;
    font-size: 13px;
}

.pkg summary::-webkit-details-marker {
    display: none;
}

.pkg summary:hover {
    background: var(--ui-bg-elevated);
}

.chev {
    flex-shrink: 0;
    color: var(--ui-text-muted);
    transition: transform 0.15s;
}

.pkg[open] .chev {
    transform: rotate(90deg);
}

.name {
    font-weight: 600;
}

.body {
    padding: 0 4px 12px 28px;
}

.body p {
    margin: 0 0 4px;
}

.url {
    padding-left: 0;
}

.link {
    color: var(--ui-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
}
</style>
