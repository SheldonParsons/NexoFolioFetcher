<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { CheckboxIndicator, CheckboxRoot, Label } from 'reka-ui'
import { credentialsCommand } from '../../auth/bridge'
import type { ServiceConfig } from '../../settings/service'
import AppIcon from '../components/AppIcon.vue'
import ServiceSummary from '../components/ServiceSummary.vue'
import InputFeedback from '../components/InputFeedback.vue'
import FetcherMark from '../components/FetcherMark.vue'

const props = defineProps<{ service: ServiceConfig | null; busy: boolean; error: string }>()
const emit = defineEmits<{ configure: []; login: [username: string, password: string, remember: boolean] }>()
const logoHovered = ref(false)
const logoFocused = ref(false)
const showPassword = ref(false)
const username = ref('')
const password = ref('')
const remember = ref(true)
const preferenceBusy = ref(false)
const preferenceError = ref('')
const fieldErrors = ref({ username: '', password: '' })
const validationRevision = ref(0)
const credentialsErrorDismissed = ref(false)
const usernameInput = ref<HTMLInputElement>()
const passwordInput = ref<HTMLInputElement>()
const credentialsError = computed(() => !credentialsErrorDismissed.value && props.error.includes('账号或密码错误') ? props.error : '')
const passwordError = computed(() => fieldErrors.value.password || credentialsError.value)
const formError = computed(() => props.error.includes('账号或密码错误') ? '' : props.error)
let credentialRequest = 0
const edited = ref(false)
let disposed = false
watch(() => props.error, () => { credentialsErrorDismissed.value = false })

function editField(field: 'username' | 'password') {
  edited.value = true
  fieldErrors.value[field] = ''
  credentialsErrorDismissed.value = true
}

watch(() => props.service?.url, async serviceUrl => {
  const request = ++credentialRequest
  username.value = password.value = ''
  edited.value = false
  preferenceError.value = ''
  if (!serviceUrl) return
  preferenceBusy.value = true
  try {
    const saved = await credentialsCommand({ type: 'credentials.get', serviceUrl })
    if (disposed || request !== credentialRequest) return
    remember.value = saved.enabled
    if (!edited.value) { username.value = saved.username; password.value = saved.password }
  } catch { if (!disposed && request === credentialRequest) preferenceError.value = '无法读取记住的账号密码，可手动输入。' }
  finally { if (request === credentialRequest) preferenceBusy.value = false }
}, { immediate: true })

async function setRemember(value: boolean | 'indeterminate') {
  if (!props.service || preferenceBusy.value || props.busy) return
  const previous = remember.value
  remember.value = value === true
  preferenceBusy.value = true
  preferenceError.value = ''
  try {
    const result = await credentialsCommand({ type: 'credentials.preference', serviceUrl: props.service.url, enabled: value === true })
    if (!disposed) remember.value = result.enabled
  } catch { if (!disposed) remember.value = previous; preferenceError.value = '无法更新记住密码设置，请重试。' }
  finally { preferenceBusy.value = false }
}
onBeforeUnmount(() => { disposed = true; ++credentialRequest; password.value = '' })

async function submit() {
  if (props.busy || preferenceBusy.value) return
  fieldErrors.value = { username: username.value.trim() ? '' : '请输入账号', password: password.value ? '' : '请输入密码' }
  validationRevision.value++
  if (fieldErrors.value.username || fieldErrors.value.password) {
    await nextTick()
    ;(fieldErrors.value.username ? usernameInput.value : passwordInput.value)?.focus()
    return
  }
  emit('login', username.value, password.value, remember.value)
}
</script>

<template>
  <section class="page-view login-view" aria-labelledby="login-title">
    <div class="login-intro">
      <span class="login-logo" tabindex="0" role="img" aria-label="NexoFolio 图标"
        @pointerenter="$event.pointerType !== 'touch' && (logoHovered = true)" @pointerleave="logoHovered = false" @pointercancel="logoHovered = false"
        @focus="logoFocused = ($event.target as HTMLElement).matches(':focus-visible')" @blur="logoFocused = false">
        <FetcherMark icon-only :active="logoHovered || logoFocused" />
      </span>
      <div class="login-heading">
        <h1 id="login-title" tabindex="-1">登录 NexoFolio</h1>
        <p class="description">使用你的 NexoFolio 账号</p>
      </div>
    </div>

    <form class="form-stack" novalidate @submit.prevent="submit">
      <div class="field">
        <Label for="username">账号</Label>
        <InputFeedback :error="fieldErrors.username" message-id="username-error" :revision="validationRevision">
          <input id="username" ref="usernameInput" v-model="username" :disabled="busy" required maxlength="100" name="username" autocomplete="username" placeholder="输入你的账号" spellcheck="false" autocapitalize="none" :aria-invalid="!!fieldErrors.username" :aria-describedby="fieldErrors.username ? 'username-error' : undefined" @input="editField('username')" />
        </InputFeedback>
      </div>
      <div class="field">
        <Label for="password">密码</Label>
        <InputFeedback :error="passwordError" message-id="password-error" :revision="validationRevision">
          <div class="input-with-action">
            <input id="password" ref="passwordInput" v-model="password" :disabled="busy" required maxlength="1024" name="password" :type="showPassword ? 'text' : 'password'" autocomplete="current-password" placeholder="输入你的密码" :aria-invalid="!!passwordError" :aria-describedby="passwordError ? 'password-error' : undefined" @input="editField('password')" />
            <button class="input-action" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'" :aria-pressed="showPassword" @click="showPassword = !showPassword">
              <AppIcon :name="showPassword ? 'eyeOff' : 'eye'" />
            </button>
          </div>
        </InputFeedback>
      </div>
      <div class="remember-credentials" title="仅保存在当前浏览器；取消后清除该服务已保存的账号密码。">
        <CheckboxRoot id="remember-credentials" class="remember-checkbox" :model-value="remember" :disabled="busy || preferenceBusy || !service" @update:model-value="setRemember"><CheckboxIndicator class="remember-indicator" force-mount><AppIcon name="check" :size="12" /></CheckboxIndicator></CheckboxRoot>
        <Label for="remember-credentials">记住账号和密码</Label>
      </div>
      <p v-if="formError || preferenceError" class="login-form-error" role="alert">{{ formError || preferenceError }}</p>
      <button class="button primary" type="submit" :disabled="busy || preferenceBusy || !service">{{ busy ? '正在登录…' : '登录' }}<AppIcon name="arrowRight" /></button>
      <p v-if="!service" class="form-note">请先配置 NexoFolio 服务。</p>
    </form>

    <ServiceSummary :service="service" @configure="$emit('configure')" />
  </section>
</template>
