<script setup lang="ts">
import { useId } from 'vue'
import { CheckboxIndicator, CheckboxRoot, Label } from 'reka-ui'
import AppIcon from './AppIcon.vue'

defineProps<{ origin: string; prefix: string; project: string; environment: string; creating: boolean; checked: boolean; disabled: boolean }>()
defineEmits<{ 'update:checked': [checked: boolean] }>()
const checkboxId = useId()
</script>

<template>
  <section class="binding-review" aria-label="归属核对">
    <h2><AppIcon name="check" :size="14" />归属核对</h2>
    <dl>
      <div><dt>当前站点</dt><dd>{{ origin }}</dd></div>
      <div><dt>采集范围</dt><dd>{{ prefix === '/' ? '整个站点' : prefix }}</dd></div>
      <div><dt>目标项目</dt><dd>{{ project }}</dd></div>
      <div><dt>目标环境</dt><dd>{{ environment }}<span v-if="creating" class="review-new">将新建</span></dd></div>
    </dl>
    <div class="binding-acknowledgement">
      <CheckboxRoot :id="checkboxId" class="remember-checkbox" :model-value="checked" :disabled="disabled" @update:model-value="$emit('update:checked', $event === true)"><CheckboxIndicator class="remember-indicator" force-mount><AppIcon name="check" :size="12" /></CheckboxIndicator></CheckboxRoot>
      <Label :for="checkboxId">我已核对，项目和环境与当前页面一致</Label>
    </div>
  </section>
</template>

<style scoped>
.binding-review { border: 1px solid #e3e3e3; border-radius: 11px; padding: 14px; background: #fafafa; min-width: 0; }
.binding-review h2 { display: flex; align-items: center; gap: 7px; color: #444; font-size: 11px; }
dl { display: grid; gap: 9px; margin: 13px 0; }
dl > div { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 10px; font-size: 11px; line-height: 1.6; }
dt { color: #777; }
dd { margin: 0; color: #333; overflow-wrap: anywhere; }
.review-new { display: inline-block; margin-left: 6px; color: #777; font-size: 10px; }
.binding-acknowledgement { display: flex; align-items: flex-start; gap: 9px; padding-top: 12px; border-top: 1px solid #e5e5e5; }
.binding-acknowledgement label { font-size: 11px; color: #444; line-height: 1.75; cursor: pointer; }
.binding-acknowledgement .remember-checkbox { margin-top: 1px; }
</style>
