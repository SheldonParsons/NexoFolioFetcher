<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import type { ServiceConfig } from '../../settings/service'
import { useAuth } from '../../auth/useAuth'
import AppIcon from '../../ui/components/AppIcon.vue'
import SaveNotice from '../../ui/components/SaveNotice.vue'
import WelcomeView from '../../ui/views/WelcomeView.vue'
import LoginView from '../../ui/views/LoginView.vue'
import ServiceSettingsView from '../../ui/views/ServiceSettingsView.vue'
import AccountView from '../../ui/views/AccountView.vue'
import LoginSuccessTransition from '../../ui/components/LoginSuccessTransition.vue'
import AccountFooter from '../../ui/components/AccountFooter.vue'
import { platformMenuKey, type PlatformMenu } from '../../platforms/menu'

type Page = 'loading' | 'welcome' | 'login' | 'settings' | 'account'
const page = ref<Page>('loading')
const settingsReturn = ref<Page>('welcome')
provide(platformMenuKey, shallowRef<PlatformMenu | null>(null))
let arrivalSequence = 0
const arrival = shallowRef<{ runId: number; sessionId: string; serviceUrl: string } | null>(null)
const auth = useAuth({ onLoginSuccess(next) {
  arrival.value = { runId: ++arrivalSequence, sessionId: next.sessionId!, serviceUrl: next.service!.url }
} })
const { state, loading, busy, error } = auth
const service = computed(() => state.value.service)
const transitioning = ref(false)
const noticeOpen = ref(false)
let noticePending = false
const main = ref<HTMLElement>()

onMounted(async () => {
  await auth.refresh(true)
  if (page.value === 'loading') page.value = state.value.user ? 'account' : state.value.reason === 'expired' ? 'login' : 'welcome'
})

watch(state, next => {
  if (arrival.value && (!next.user || next.sessionId !== arrival.value.sessionId || next.service?.url !== arrival.value.serviceUrl)) arrival.value = null
  if (page.value === 'settings') return
  if (next.user) page.value = 'account'
  else if (next.reason === 'expired') page.value = 'login'
  else if (page.value === 'account') page.value = 'welcome'
})

function navigate(target: Page) {
  if (busy.value || transitioning.value || target === page.value) return
  if (target === 'account' && !state.value.user) target = 'login'
  arrival.value = null
  if (target === 'settings' && page.value !== 'settings') settingsReturn.value = page.value
  noticeOpen.value = false
  noticePending = false
  error.value = ''
  page.value = target
}

function beginLeave(element: Element) {
  transitioning.value = true
  const leaving = element as HTMLElement
  leaving.inert = true
}

async function focusPage() {
  transitioning.value = false
  await nextTick()
  if (!arrival.value) main.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  main.value?.scrollTo({ top: 0 })
  if (noticePending) {
    noticePending = false
    noticeOpen.value = true
  }
}

async function persist(config: ServiceConfig) {
  if (busy.value || transitioning.value) return
  if (await auth.configure(config)) {
    page.value = state.value.user ? 'account' : 'login'
    noticePending = true
  }
}

async function login(account: string, password: string, remember: boolean) {
  if (transitioning.value) return
  if (await auth.login(account, password, remember)) page.value = state.value.user ? 'account' : 'login'
}

async function logout() {
  arrival.value = null
  if (transitioning.value) return
  if (await auth.logout()) page.value = 'welcome'
}

async function finishArrival(runId: number) {
  if (arrival.value?.runId !== runId) return
  arrival.value = null
  await nextTick()
  if (!arrival.value) main.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}
onBeforeUnmount(() => { arrival.value = null; ++arrivalSequence })
</script>

<template>
  <div class="panel-shell">
    <main ref="main" class="panel-main" :inert="!!arrival">
      <Transition name="panel-reveal" :mode="arrival ? undefined : 'out-in'" @before-leave="beginLeave" @after-enter="focusPage">
        <div :key="`${page}:${service?.url || ''}`" class="page-frame" :inert="transitioning">
          <div class="page-navigation" v-if="page === 'login' || page === 'settings'">
            <button class="back-button" type="button" :disabled="busy" @click="navigate(page === 'settings' ? settingsReturn : 'welcome')"><AppIcon name="arrowLeft" :size="16" />返回</button>
            <span v-if="page === 'settings'">服务设置</span>
          </div>
          <section v-if="page === 'loading'" class="loading-view"><h1 tabindex="-1">正在确认登录状态…</h1></section>
          <template v-else-if="page === 'welcome'">
            <p v-if="error" class="global-notice" role="alert">{{ error }}</p>
            <WelcomeView :service="service" :loading="loading" @login="navigate('login')" @configure="!loading && navigate('settings')" />
          </template>
          <LoginView v-else-if="page === 'login'" :service="service" :busy="busy" :error="error || state.message || ''" @login="login" @configure="navigate('settings')" />
          <AccountView v-else-if="page === 'account'" :state="state" :busy="busy" :error="error" @retry="auth.retry()" />
          <ServiceSettingsView v-else :service="service" :saving="busy" :save-error="error" @save="persist" />
        </div>
      </Transition>
    </main>
    <AccountFooter v-if="page === 'account' && state.user" :state="state" :busy="busy" :inert="!!arrival" @configure="navigate('settings')" @logout="logout" />
    <footer v-else class="app-footer"><span><i></i>NEXOFOLIO FETCHER</span><span>v0.1.0</span></footer>
    <SaveNotice v-model:open="noticeOpen" />
    <LoginSuccessTransition v-if="arrival" :key="arrival.runId" :run-id="arrival.runId" @complete="finishArrival" />
  </div>
</template>
