<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { Label, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'
import type { Environment } from '../../api/nexofolio/environments'
import AppIcon from './AppIcon.vue'
import InputFeedback from './InputFeedback.vue'

const props = defineProps<{
  project: string; options: Environment[]; total: number; loading: boolean; listError: string
  environmentId?: string; name: string; creating: boolean; duplicate?: Environment
  error: string; revision: number; disabled: boolean
}>()
const emit = defineEmits<{
  choose: [environment: Environment]; create: []; cancel: []; rename: [name: string]; validate: []; load: [more: boolean]
}>()
const fieldId = useId(), input = ref<HTMLInputElement>()
const trigger = ref<InstanceType<typeof SelectTrigger>>(), createButton = ref<HTMLButtonElement>()
// The saved environment can be beyond the first page; retain its explicit selection.
const items = computed(() => props.environmentId && !props.options.some(option => option.id === props.environmentId)
  ? [{ id: props.environmentId, name: props.name }, ...props.options] : props.options)
function choose(value: unknown) {
  const option = items.value.find(item => item.id === value)
  if (option) void selectEnvironment(option)
}
async function selectEnvironment(option: Environment) {
  const wasCreating = props.creating
  emit('choose', option)
  if (wasCreating) { await nextTick(); focusChoices() }
}
function focusChoices() {
  if (items.value.length) trigger.value?.$el?.focus()
  else createButton.value?.focus()
}
async function cancel() {
  emit('cancel')
  await nextTick()
  focusChoices()
}
async function create() {
  emit('create')
  await nextTick()
  input.value?.focus()
}
</script>

<template>
  <div class="environment-picker" :aria-busy="loading">
    <div class="field-intro">
      <div class="environment-heading">
        <Label :for="fieldId">{{ creating ? '新环境名称' : '当前网页的环境' }}</Label>
        <button v-if="creating" type="button" class="environment-back" :disabled="disabled" @click="cancel"><AppIcon name="arrowLeft" :size="12" />选择现有环境</button>
      </div>
      <p :id="`${fieldId}-hint`">{{ creating ? '填写当前网页实际所在的环境，如测试、UAT、生产。' : '请选择当前网页实际所在环境，例如测试、UAT、生产；不会根据域名自动判断。' }}</p>
    </div>
    <template v-if="!creating">
      <SelectRoot :model-value="environmentId || ''" :disabled="disabled || !items.length" @update:model-value="choose">
        <SelectTrigger :id="fieldId" ref="trigger" class="environment-trigger" :aria-describedby="`${fieldId}-hint`" :aria-invalid="!!error">
          <SelectValue>{{ environmentId ? name : loading ? '正在读取现有环境…' : '请选择现有环境' }}</SelectValue>
          <AppIcon class="environment-chevron" name="chevronRight" :size="14" />
        </SelectTrigger>
        <SelectPortal>
          <SelectContent class="environment-menu" position="popper" :side-offset="6" :collision-padding="16">
            <SelectViewport class="environment-menu-viewport">
              <SelectItem v-for="option in items" :key="option.id" class="environment-option" :value="option.id" :text-value="option.name">
                <SelectItemText>{{ option.name }}</SelectItemText>
                <SelectItemIndicator class="environment-option-check"><AppIcon name="check" :size="14" /></SelectItemIndicator>
              </SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>
      <p v-if="!loading && !listError && !options.length" class="environment-note" role="status">该项目暂无环境，可选择下方「创建新环境」。</p>
      <p v-if="error" class="environment-note" role="alert">{{ error }}</p>
      <div class="environment-actions">
        <button ref="createButton" type="button" class="inline-button" :disabled="disabled || loading || !!listError" @click="create"><AppIcon name="plus" :size="13" />创建新环境</button>
        <button v-if="options.length < total" type="button" class="inline-button" :disabled="disabled || loading" @click="$emit('load', true)">{{ loading ? '读取中…' : `加载更多（${options.length}/${total}）` }}</button>
      </div>
    </template>
    <div v-else class="new-environment">
      <InputFeedback :error="error" :message-id="`${fieldId}-error`" :revision="revision">
        <input :id="fieldId" ref="input" class="environment-name" :value="name" :disabled="disabled" autocomplete="off" spellcheck="false" placeholder="例如：UAT" :aria-invalid="!!error" :aria-describedby="`${fieldId}-hint ${fieldId}-destination${error ? ` ${fieldId}-error` : ''}`" @input="$emit('rename', ($event.target as HTMLInputElement).value)" @blur="$emit('validate')" />
      </InputFeedback>
      <p :id="`${fieldId}-destination`" class="new-environment-destination">将在 <span>{{ project }}</span> 下创建，确认绑定后生效。</p>
      <p v-if="duplicate" class="environment-note">已存在同名环境。<button type="button" class="inline-button" :disabled="disabled" @click="selectEnvironment(duplicate)">使用现有「{{ duplicate.name }}」</button></p>
    </div>
    <p v-if="listError" class="environment-note" role="status">{{ listError }}<button type="button" class="inline-button" :disabled="disabled || loading" @click="$emit('load', false)">{{ loading ? '读取中…' : '重新读取' }}</button></p>
  </div>
</template>

<style scoped>
.environment-picker { display: grid; gap: 10px; min-width: 0; }
.environment-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; }
.environment-heading > label { font-size: 12px; font-weight: 550; }
.environment-back { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 4px; padding: 2px 0; background: transparent; color: #777; font-size: 10px; line-height: 1.6; }
.environment-back:hover:not(:disabled) { color: #222; }
.environment-back:disabled { color: #999; }
.environment-trigger { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-width: 0; min-height: 40px; padding: 9px 11px; border: 1px solid #ddd; border-radius: 8px; background: #fff; color: #333; font-size: 12px; text-align: left; }
.environment-trigger > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.environment-trigger:disabled { color: #777; background: #fafafa; }
.environment-trigger:hover:not(:disabled), .environment-trigger[data-state='open'] { border-color: #999; }
.environment-chevron { transform: rotate(90deg); color: #888; }
.environment-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 10px; }
.environment-picker .inline-button { display: inline-flex; padding: 3px 0; font-size: 11px; text-align: left; overflow-wrap: anywhere; }
.environment-picker .inline-button:disabled { color: #999; }
.environment-note { margin: 0; font-size: 11px; line-height: 1.8; color: #727272; overflow-wrap: anywhere; }
.new-environment { display: grid; gap: 8px; min-width: 0; }
.environment-name { height: 40px; padding: 0 11px; border-radius: 8px; transition: border-color 150ms, box-shadow 150ms; }
.environment-name:focus { outline: none; border-color: #666; box-shadow: 0 0 0 2px #00000008; }
.new-environment-destination { margin: 0; color: #777; font-size: 10px; line-height: 1.8; overflow-wrap: anywhere; }
.new-environment-destination > span { color: #555; }
</style>
