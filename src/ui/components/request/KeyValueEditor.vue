<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import { pair, type DraftPair } from '../../../replay/draft'
import AppIcon from '../AppIcon.vue'

const props = defineProps<{ rows: DraftPair[]; label: string; readonly?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ change: [rows: DraftPair[]] }>()
const root = ref<HTMLElement>()
function change(id: string, key: 'name' | 'value' | 'enabled', value: string | boolean) {
  emit('change', props.rows.map(row => {
    if (row.id !== id) return row
    const next = { ...row, [key]: value, ...(key === 'enabled' ? {} : { raw: undefined }) } as DraftPair
    return next
  }))
}
async function add() {
  emit('change', [...props.rows, pair()])
  await nextTick()
  root.value?.querySelector<HTMLInputElement>('.kv-row:last-child input')?.focus()
}
</script>
<template>
  <div ref="root" class="kv-editor" :class="{ readonly }">
    <div class="kv-heading"><span>{{ label }} · {{ readonly ? rows.length : rows.filter(row => row.enabled).length }}</span><button v-if="!readonly" type="button" :disabled="disabled || rows.length >= 256" @click="add"><AppIcon name="plus" :size="12" />添加</button></div>
    <div v-if="rows.length" class="kv-scroll" :aria-label="label">
      <div v-for="(row, index) in rows" :key="row.id" class="kv-row" :class="{ muted: !readonly && !row.enabled }">
        <CheckboxRoot v-if="!readonly" class="kv-check" :model-value="row.enabled" :disabled="disabled" :aria-label="`启用第 ${index + 1} 项`" @update:model-value="change(row.id, 'enabled', $event === true)"><CheckboxIndicator><AppIcon name="check" :size="10" /></CheckboxIndicator></CheckboxRoot>
        <div class="kv-fields">
          <template v-if="readonly"><code>{{ row.name || '（空键）' }}</code><pre>{{ row.value === '' ? '（空值）' : row.value }}</pre></template>
          <template v-else>
            <input :value="row.name" :disabled="disabled" :aria-label="`${label}第 ${index + 1} 项名称`" placeholder="名称" autocomplete="off" spellcheck="false" @input="change(row.id, 'name', ($event.target as HTMLInputElement).value)" />
            <input :value="row.value" :disabled="disabled" :aria-label="`${label}第 ${index + 1} 项值`" placeholder="值（允许为空）" autocomplete="off" spellcheck="false" @input="change(row.id, 'value', ($event.target as HTMLInputElement).value)" />
          </template>
        </div>
        <button v-if="!readonly" class="kv-remove" type="button" :disabled="disabled" :aria-label="`删除第 ${index + 1} 项`" @click="emit('change', rows.filter(item => item.id !== row.id))"><span aria-hidden="true">×</span></button>
      </div>
    </div>
    <p v-else class="kv-empty">{{ readonly ? '没有可展示的条目。' : '尚无条目，点击「添加」开始编辑。' }}</p>
  </div>
</template>
<style scoped>
.kv-editor { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.kv-heading { display: flex; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 2px 6px; color: #777; font-size: 10px; flex-shrink: 0; }
.kv-heading button { display: inline-flex; align-items: center; gap: 3px; border: 0; background: none; color: #444; font-size: 10px; padding: 4px; border-radius: 4px; }
.kv-scroll { min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #ccc transparent; }
.kv-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) 20px; gap: 7px; padding: 9px 2px; border-top: 1px solid #eee; }
.kv-fields { min-width: 0; display: grid; gap: 5px; }
.kv-fields input { height: 29px; padding: 4px 7px; border: 1px solid #e5e5e5; border-radius: 5px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.kv-fields input:first-child { font-weight: 550; background: #fafafa; }
.kv-fields input:focus { outline: none; border-color: #888; box-shadow: 0 0 0 2px #00000007; }
.kv-check { display: grid; place-items: center; width: 14px; height: 14px; padding: 0; margin-top: 7px; border: 1px solid #ccc; border-radius: 4px; background: #fff; color: #fff; }
.kv-check[data-state='checked'] { border-color: #444; background: #444; }
.kv-remove { width: 20px; height: 26px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #888; font-size: 18px; line-height: 1; }
.kv-remove:hover { background: #eee; color: #333; }
.muted .kv-fields input { color: #999; }
.kv-empty { margin: 14px 0; font-size: 11px; line-height: 1.8; color: #888; }
.readonly .kv-row { grid-template-columns: minmax(0, 1fr); padding: 10px 2px; }
.kv-fields code, .kv-fields pre { margin: 0; color: #444; font: 11px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.kv-fields code { color: #777; font-size: 10px; }
@container request-pane (min-width: 470px) { .kv-fields { grid-template-columns: minmax(100px, .7fr) minmax(0, 1fr); } }
</style>
