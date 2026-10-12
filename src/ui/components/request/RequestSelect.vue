<script setup lang="ts">
import { SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui'
import AppIcon from '../AppIcon.vue'
defineProps<{ modelValue: string; label: string; options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean; compact?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <SelectRoot :model-value="modelValue" :disabled="disabled" @update:model-value="emit('update:modelValue', String($event))">
    <SelectTrigger class="request-select" :class="{ compact }" :aria-label="label"><SelectValue /><AppIcon name="chevronRight" :size="12" /></SelectTrigger>
    <SelectPortal>
      <SelectContent class="request-select-menu" position="popper" align="start" :side-offset="6" :collision-padding="12">
        <SelectViewport class="request-select-viewport">
          <SelectItem v-for="option in options" :key="option.value" class="request-select-option" :value="option.value" :disabled="option.disabled">
            <SelectItemText>{{ option.label }}</SelectItemText><SelectItemIndicator><AppIcon name="check" :size="13" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
<style scoped>
.request-select { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; min-height: 34px; padding: 7px 10px; border: 1px solid #ddd; border-radius: 7px; background: #fff; color: #333; font-size: 11px; text-align: left; }
.request-select > svg { transform: rotate(90deg); color: #888; }
.request-select.compact { min-height: 27px; padding: 3px 7px; font-size: 10px; border-color: transparent; background: #f3f3f3; }
.request-select:disabled { opacity: .5; }
.request-select > :first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
<style>
/* SelectContent has fragment/Presence/Portal roots: its forwarded native node does
   not inherit this SFC's scope ID. Portal classes deliberately have global scope. */
.request-select-menu { z-index: 60; isolation: isolate; display: flex; flex-direction: column; min-width: max(144px, var(--reka-select-trigger-width)); max-width: calc(100vw - 24px); max-height: min(300px, var(--reka-select-content-available-height)); overflow: hidden; padding: 4px; border: 1px solid #ddd; border-radius: 9px; background: #fff; color: #333; box-shadow: 0 8px 24px #00000018, 0 2px 5px #00000008; outline: none; }
.request-select-viewport { min-height: 0; }
.request-select-option { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 30px; padding: 6px 8px; border-radius: 5px; color: #444; font-size: 11px; outline: none; cursor: pointer; }
.request-select-option > :first-child { min-width: 0; overflow-wrap: anywhere; }
.request-select-option[data-highlighted] { color: #111; background: #eee; }
.request-select-option[data-state='checked'] { color: #222; background: #f5f5f5; }
.request-select-option[data-disabled] { opacity: .4; pointer-events: none; }
.request-select-menu[data-state='open'] { animation: account-menu-in 140ms var(--panel-ease); }
.request-select-menu[data-state='closed'] { animation: account-menu-out 100ms ease-in; }
</style>
