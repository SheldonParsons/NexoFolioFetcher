<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger, Label } from 'reka-ui'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ origin: string }>()
const open = ref(false), copying = ref(false), copied = ref(false), copyError = ref(false)
const requestId = useId()
// Only the origin enters the copy template; never page paths, query strings or fragments.
const request = computed(() => [
  '管理员你好，申请创建 NexoFolio 业务项目并绑定已有禅道权限：',
  `当前站点：${new URL(props.origin).origin}`,
  '业务项目名称：［请补充］',
  '现有禅道项目：［请补充］',
  '环境：［请补充，例如测试 / UAT / 生产］',
].join('\n'))
watch(() => props.origin, () => { copied.value = copyError.value = false; open.value = false })
async function copy() {
  const origin = props.origin
  copying.value = true; copied.value = copyError.value = false
  try {
    await navigator.clipboard.writeText(request.value)
    if (props.origin === origin) copied.value = true
  } catch { if (props.origin === origin) copyError.value = true }
  finally { copying.value = false }
}
</script>

<template>
  <CollapsibleRoot v-model:open="open" class="project-help">
    <CollapsibleTrigger class="project-help-trigger" type="button">
      <span>找不到对应项目？<strong>联系管理员创建</strong></span>
      <AppIcon class="disclosure-chevron" name="chevronRight" :size="13" />
    </CollapsibleTrigger>
    <CollapsibleContent class="binding-disclosure">
      <div class="project-help-content">
        <p>一个禅道项目可对应多个 NexoFolio 业务项目。联系管理员在后台创建，并绑定已有禅道权限。</p>
        <p>例如：巴西售后可独立建项目，沿用云售后权限。请勿用名称相近的项目临时代替。</p>
        <button type="button" class="copy-request" :disabled="copying" @click="copy"><AppIcon :name="copied ? 'check' : 'copy'" :size="14" />{{ copying ? '正在复制…' : copied ? '已复制申请信息' : '复制申请信息' }}</button>
        <p class="project-help-caption" role="status">{{ copied ? '补充业务项目名称、现有禅道项目和环境后，自行发给管理员。' : '只带入站点地址，补充信息后自行发送。' }}</p>
        <template v-if="copyError">
          <Label :for="requestId">复制未成功，可选中以下申请信息手动复制</Label>
          <textarea :id="requestId" class="request-template" :value="request" readonly rows="7" @focus="($event.target as HTMLTextAreaElement).select()" />
        </template>
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.project-help { min-width: 0; }
.project-help-trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 7px 0; border: 0; border-radius: 4px; color: #747474; background: transparent; text-align: left; font-size: 11px; line-height: 1.8; }
.project-help-trigger strong { color: #333; font-weight: 500; }
.project-help-trigger:hover strong { text-decoration: underline; text-underline-offset: 3px; }
.project-help-content { display: grid; gap: 10px; padding: 10px 0 4px 12px; border-left: 1px solid #ddd; margin: 3px 0 4px; font-size: 11px; line-height: 1.8; color: #666; }
.project-help-content p { margin: 0; }
.copy-request { display: flex; align-items: center; justify-content: center; gap: 7px; width: fit-content; max-width: 100%; min-height: 32px; padding: 6px 10px; border: 1px solid #ddd; border-radius: 7px; background: #fff; color: #333; font-size: 11px; }
.copy-request:hover:not(:disabled) { background: #f6f6f6; }
.project-help-caption { color: #777; font-size: 10px; }
.request-template { width: 100%; resize: vertical; padding: 9px; border: 1px solid #ddd; border-radius: 7px; font: inherit; color: #555; background: #fafafa; }
.request-template:focus-visible { outline: 2px solid #555; outline-offset: 3px; }
</style>
