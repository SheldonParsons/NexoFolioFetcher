<script setup lang="ts">
import { ref } from 'vue'
import { Label } from 'reka-ui'
import { normalizeServiceUrl, type ServiceConfig } from '../../settings/service'
import AppIcon from '../components/AppIcon.vue'

const props = defineProps<{ service: ServiceConfig | null; saving: boolean; saveError: string }>()
const emit = defineEmits<{ save: [config: ServiceConfig] }>()
const name = ref(props.service?.name || '')
const url = ref(props.service?.url || '')
const validationError = ref('')
const urlInput = ref<HTMLInputElement>()

function submit() {
  try {
    const normalizedUrl = normalizeServiceUrl(url.value)
    validationError.value = ''
    emit('save', { name: name.value, url: normalizedUrl })
  } catch (error) {
    validationError.value = error instanceof Error ? error.message : '请检查服务地址。'
    urlInput.value?.focus()
  }
}
</script>

<template>
  <section class="page-view" aria-labelledby="settings-title">
    <span class="eyebrow">SERVICE CONNECTION</span>
    <h1 id="settings-title" tabindex="-1">配置服务</h1>

    <form class="form-stack settings-form" novalidate @submit.prevent="submit">
      <div class="field">
        <Label for="service-name">服务名称 <span class="optional">选填</span></Label>
        <input id="service-name" v-model="name" :disabled="saving" maxlength="80" autocomplete="off" />
      </div>
      <div class="field">
        <Label for="service-url">后端服务地址</Label>
        <input id="service-url" ref="urlInput" v-model="url" :disabled="saving" type="text" inputmode="url" autocomplete="url" spellcheck="false" autocapitalize="none" placeholder="https://service.example.com" :aria-invalid="!!validationError" aria-required="true" :aria-describedby="validationError ? 'url-error' : undefined" @input="validationError = ''" />
        <p v-if="validationError" id="url-error" class="field-error" role="alert">{{ validationError }}</p>
      </div>
      <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
      <button class="button primary" type="submit" :disabled="saving">{{ saving ? '正在保存…' : '保存服务' }}<AppIcon :name="saving ? 'check' : 'arrowRight'" /></button>
    </form>

  </section>
</template>
