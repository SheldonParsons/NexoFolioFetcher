<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { Label } from 'reka-ui'
import { useEnvironmentOptions } from '../../platforms/environmentOptions'
import type { Environment, EnvironmentPage } from '../../api/nexofolio/environments'
import { platformCommand } from '../../platforms/bridge'
import { SITE_CACHE_PREFIX, type LegacyProject, type Named, type PlatformCommand, type PlatformContext, type PlatformScope } from '../../platforms/contracts'
import { matchesPath, normalizeScope } from '../../platforms/scope'
import { serviceOriginPattern } from '../../auth/contracts'
import AppIcon from '../components/AppIcon.vue'
import InputFeedback from '../components/InputFeedback.vue'
import ProjectPicker from '../components/ProjectPicker.vue'
import { platformMenuKey } from '../../platforms/menu'
import { useCapture } from '../../capture/useCapture'
import CaptureFeed from '../components/CaptureFeed.vue'
import PlatformBindingCard from '../components/PlatformBindingCard.vue'

// Old local bindings are still read while they wait for migration or a choice.
const LEGACY_STORAGE_PREFIX = 'nexofolio.platforms.v1:'

const context = ref<PlatformContext | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const scopeError = ref('')
const scopeRevision = ref(0)
const prefix = ref('/')
const step = ref<'scope' | 'project' | 'environment' | null>(null)
const environmentName = ref('')
const environmentId = ref<string>()
const environmentError = ref('')
const environmentRevision = ref(0)
const chosen = ref<Named | null>(null)
const panelRoot = ref<HTMLElement>()
const menu = inject(platformMenuKey, null)
const menuOwner = Symbol('active-platform')
let windowId: number | undefined
let version = 0
let disposed = false
let refreshPending = false
let timer: ReturnType<typeof setTimeout> | undefined

const target = computed(() => context.value?.page ?? null)
const binding = computed(() => context.value?.binding ?? null)
// Subscribe to history for the lifetime of the logged-in panel. The background
// independently gates new capture by the active page authorization and binding.
const capture = useCapture()
const platformName = computed(() => target.value?.title || (loading.value ? '读取中…' : '选择网页'))
const projectLabel = computed(() => binding.value?.project.name || (context.value?.status === 'unauthorized' ? '未授权' : '未绑定'))
const scopeOptions = computed(() => {
  const parts = (target.value?.pathname || '/').split('/').filter(Boolean)
  return ['/', ...parts.slice(0, 5).map((_, index) => '/' + parts.slice(0, index + 1).join('/'))]
})

function resetEnvironment(name = '', id?: string) {
  environmentName.value = name; environmentId.value = id; environmentError.value = ''
}
function accept(next: PlatformContext, reset: boolean) {
  const changed = context.value?.page?.tabId !== next.page?.tabId || context.value?.page?.address !== next.page?.address
  context.value = next
  if (reset || changed) {
    prefix.value = next.binding?.prefix || '/'
    resetEnvironment()
    chosen.value = null
    scopeError.value = ''
    step.value = null
  }
}
async function refresh(reset = false) {
  if (disposed || windowId === undefined) return
  if (busy.value) { refreshPending = true; ++version; loading.value = true; return }
  const request = ++version
  loading.value = true
  try {
    const next = await platformCommand({ type: 'platform.context', windowId })
    if (disposed || request !== version) return
    error.value = ''
    accept(next, reset)
  } catch (cause) {
    if (!disposed && request === version) { context.value = null; error.value = cause instanceof Error ? cause.message : '无法读取当前站点。' }
  } finally { if (request === version) loading.value = false }
}
function scheduleRefresh() {
  if (disposed) return
  loading.value = true
  ++version
  clearTimeout(timer)
  timer = setTimeout(() => void refresh(true), 80)
}
function settle() {
  busy.value = false
  if (refreshPending) { refreshPending = false; void refresh(true) }
}
// Native permission must originate from the user's click; only this site's host is requested.
async function allow(origin: string) {
  try {
    const pattern = { origins: [serviceOriginPattern(origin)] }
    if (await chrome.permissions.request(pattern) || await chrome.permissions.contains(pattern)) return true
    error.value = '未获得访问许可。'
  } catch { error.value = '无法获取访问许可，请重试。' }
  return false
}
async function perform(command: PlatformCommand) {
  const request = ++version
  busy.value = true
  error.value = ''
  try {
    const next = await platformCommand(command)
    if (disposed || request !== version) return
    accept(next, true)
  } catch (cause) {
    if (!disposed && request === version) error.value = cause instanceof Error ? cause.message : '操作失败，请重试。'
  } finally { settle() }
}
async function authorize() {
  if (!target.value || busy.value || loading.value) return
  const origin = target.value.origin
  busy.value = true; error.value = ''
  const allowed = await allow(origin)
  settle()
  if (allowed) scheduleRefresh()
}
async function confirmScope() {
  if (!target.value || busy.value || loading.value) return
  const current = target.value
  scopeRevision.value++
  try {
    const scope = normalizeScope(current.origin, prefix.value)
    if (!matchesPath(current.pathname, scope.prefix)) throw new Error('当前页面不在这个路径范围内。')
    prefix.value = scope.prefix
  } catch (cause) { scopeError.value = cause instanceof Error ? cause.message : '请检查路径范围。'; return }
  scopeError.value = ''
  busy.value = true; error.value = ''
  const allowed = await allow(current.origin)
  settle()
  if (!allowed || disposed || target.value !== current) return
  openProjectStep(prefix.value)
}
function openProjectStep(scopePrefix: string) {
  prefix.value = scopePrefix
  chosen.value = null
  resetEnvironment()
  error.value = ''
  step.value = 'project'
  void focusEditor()
}
function editScope() {
  if (busy.value || loading.value) return
  prefix.value = target.value?.pathname || '/'
  step.value = 'scope'
  error.value = scopeError.value = ''
  chosen.value = null
  void focusEditor()
}
function editProject() {
  if (busy.value || loading.value || !binding.value) return
  openProjectStep(binding.value.prefix)
}
function editEnvironment() {
  if (busy.value || loading.value || !binding.value) return
  resetEnvironment(binding.value.environment.name, binding.value.environment.id)
  step.value = 'environment'
  void focusEditor()
}
function validateEnvironment() {
  environmentRevision.value++
  environmentError.value = !!environmentName.value.trim() && [...environmentName.value.trim()].length <= 64 && !/[\u0000-\u001f\u007f]/.test(environmentName.value) ? '' : '环境名称需为1–64个字符，不含控制字符'
  return !environmentError.value
}
const environmentProject = computed(() => step.value === 'project' ? chosen.value?.id : step.value === 'environment' ? binding.value?.project.id : undefined)
const {
  options: environmentOptions, total: environmentTotal, loading: environmentLoading,
  error: environmentListError, load: loadEnvironments, reset: resetEnvironmentOptions,
} = useEnvironmentOptions(environmentProject, environmentId, environmentName,
  (projectId, page) => platformCommand<EnvironmentPage>({ type: 'platform.environments', projectId, page }))
function chooseEnvironment(value: Environment) { resetEnvironment(value.name, value.id) }
function editEnvironmentName() { environmentId.value = undefined; environmentError.value = '' }
function selectBindingProject(project: Named | null) {
  const same = chosen.value?.id === project?.id
  // Do not carry a previous project's environment.
  resetEnvironment()
  resetEnvironmentOptions()
  chosen.value = project ? { id: project.id, name: project.name } : null
  if (same && project) void loadEnvironments()
}
async function focusEditor() {
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLInputElement>('form input')?.focus()
}
async function back() {
  if (busy.value) return
  step.value = null
  chosen.value = null
  prefix.value = binding.value?.prefix || '/'
  error.value = scopeError.value = ''
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}
function save(scope: PlatformScope, project: Named, environment: { id?: string; name: string }) {
  if (!target.value) return
  void perform({ type: 'platform.bind', target: target.value, scope: { origin: scope.origin, prefix: scope.prefix }, project, environment })
}
function bind() {
  if (!target.value || !chosen.value || busy.value || loading.value || !validateEnvironment()) return
  save({ origin: target.value.origin, prefix: prefix.value }, chosen.value, { id: environmentId.value, name: environmentName.value.trim() })
}
function saveEnvironment() {
  if (!binding.value || busy.value || loading.value || !validateEnvironment()) return
  save(binding.value, binding.value.project, { id: environmentId.value, name: environmentName.value.trim() })
}
// F9: an old scope with several projects is resolved by the user, once.
async function chooseLegacy(project: LegacyProject) {
  const legacy = context.value?.legacy
  if (!legacy || busy.value || loading.value) return
  busy.value = true; error.value = ''
  const allowed = await allow(legacy.origin)
  settle()
  if (allowed) save(legacy, { id: project.id, name: project.name }, { id: project.environmentId, name: project.environmentName ?? '' })
}
watchEffect(() => {
  if (!menu || disposed) return
  menu.value = {
    owner: menuOwner,
    busy: busy.value || loading.value,
    canEditProject: context.value?.status === 'bound',
    canEditScope: !!target.value,
    canEditEnvironment: !!binding.value && context.value?.status === 'bound',
    editProject, editScope, editEnvironment,
  }
})
const activated = (info: Parameters<Parameters<typeof chrome.tabs.onActivated.addListener>[0]>[0]) => { if (info.windowId === windowId) scheduleRefresh() }
const updated = (id: number, changes: Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>[1], tab: chrome.tabs.Tab) => {
  if (id === target.value?.tabId && changes.favIconUrl !== undefined && context.value?.page) {
    context.value = { ...context.value, page: { ...context.value.page, faviconUrl: changes.favIconUrl } }
  }
  if (tab.windowId === windowId && tab.active && (changes.url !== undefined || changes.status === 'complete')) scheduleRefresh()
}
const removed = (tabId: number) => { if (tabId === target.value?.tabId) scheduleRefresh() }
const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  // Refreshing only on real changes: the background writes the cache only when it differs.
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith(SITE_CACHE_PREFIX) || key.startsWith(LEGACY_STORAGE_PREFIX)) && !busy.value && !step.value) scheduleRefresh()
}
const permissionsChanged = () => { if (!busy.value && !step.value) scheduleRefresh() }
const visible = () => { if (document.visibilityState === 'visible' && !step.value) scheduleRefresh() }
onMounted(async () => {
  chrome.tabs.onActivated.addListener(activated)
  chrome.tabs.onUpdated.addListener(updated)
  chrome.tabs.onRemoved.addListener(removed)
  chrome.storage.onChanged.addListener(storageChanged)
  chrome.permissions.onRemoved.addListener(permissionsChanged)
  chrome.permissions.onAdded.addListener(permissionsChanged)
  document.addEventListener('visibilitychange', visible)
  try { windowId = (await chrome.windows.getCurrent()).id; await refresh(true) }
  catch { error.value = '无法读取当前浏览器窗口。'; loading.value = false }
})
onBeforeUnmount(() => {
  disposed = true; ++version; clearTimeout(timer)
  if (menu?.value?.owner === menuOwner) menu.value = null
  chrome.tabs.onActivated.removeListener(activated)
  chrome.tabs.onUpdated.removeListener(updated)
  chrome.tabs.onRemoved.removeListener(removed)
  chrome.storage.onChanged.removeListener(storageChanged)
  chrome.permissions.onRemoved.removeListener(permissionsChanged)
  chrome.permissions.onAdded.removeListener(permissionsChanged)
  document.removeEventListener('visibilitychange', visible)
})
</script>

<template>
  <section ref="panelRoot" class="platform-panel" :class="{ 'is-capture-view': !step && context?.status === 'bound' }" aria-labelledby="account-title">
    <button v-if="step" type="button" class="back-button platform-back" :disabled="busy" @click="back"><AppIcon name="arrowLeft" :size="14" />返回</button>
    <PlatformBindingCard :favicon-url="target?.faviconUrl" :platform="platformName" :project="projectLabel" :environment="binding?.environment.name" :active="capture.snapshot.value.status === 'listening'" />
    <p v-if="error" class="platform-error" role="alert">{{ error }}</p>
    <button v-if="!context && !loading" class="inline-button" type="button" @click="refresh(true)">重新读取<AppIcon name="arrowRight" :size="14" /></button>
    <p v-if="context?.status === 'unsupported'" class="platform-hint">请等待页面加载，或切换到 HTTP / HTTPS 网页。</p>
    <p v-if="context?.offline" class="platform-hint" role="status">无法连接 NexoFolio，暂按本地缓存的绑定显示。</p>
    <template v-if="target">
      <form v-if="step === 'scope'" class="platform-form" novalidate @submit.prevent="confirmScope">
        <h2>选择站点范围</h2>
        <div class="field">
          <Label for="platform-prefix">路径范围</Label>
          <InputFeedback :error="scopeError" message-id="scope-error" :revision="scopeRevision"><input id="platform-prefix" v-model="prefix" :disabled="busy || loading" maxlength="2048" :aria-invalid="!!scopeError" :aria-describedby="scopeError ? 'scope-error' : undefined" @input="scopeError = ''" /></InputFeedback>
          <div class="scope-options"><button v-for="option in scopeOptions" :key="option" class="scope-option" :class="{ selected: prefix === option }" type="button" :disabled="busy || loading" @click="prefix = option; scopeError = ''">{{ option === '/' ? '整个站点 /' : option }}</button></div>
        </div>
        <p class="platform-hint">更具体的路径优先匹配。绑定保存在 NexoFolio，登录同一服务的插件都会使用。</p>
        <p v-if="binding && prefix.length < binding.prefix.length" class="platform-hint">此页面已有更具体的 {{ binding.prefix }} 绑定，仍会优先使用该绑定。</p>
        <button class="button primary" type="submit" :disabled="busy || loading">{{ busy ? '正在授权…' : '授权并选择项目' }}<AppIcon name="arrowRight" /></button>
      </form>
      <form v-else-if="step === 'environment'" class="platform-form" novalidate @submit.prevent="saveEnvironment">
        <h2>更换环境</h2>
        <p class="platform-hint">{{ binding?.project.name }} · {{ binding?.origin }}{{ binding?.prefix }}</p>
        <div class="field">
          <Label for="binding-environment">环境名称</Label>
          <InputFeedback :error="environmentError" message-id="environment-error" :revision="environmentRevision"><input id="binding-environment" v-model="environmentName" :disabled="busy || loading" autocomplete="off" spellcheck="false" placeholder="例如 开发环境" @input="editEnvironmentName" /></InputFeedback>
          <div v-if="environmentOptions.length" class="scope-options"><button v-for="option in environmentOptions" :key="option.id" type="button" class="scope-option" :class="{ selected: option.id === environmentId }" :disabled="busy || loading" @click="chooseEnvironment(option)">{{ option.name }}</button></div>
        </div>
        <p v-if="environmentListError" class="platform-hint">{{ environmentListError }} <button type="button" class="inline-button" :disabled="environmentLoading" @click="loadEnvironments()">重新读取</button></p>
        <button v-if="environmentOptions.length < environmentTotal" type="button" class="inline-button" :disabled="environmentLoading" @click="loadEnvironments(true)">更多环境</button>
        <button class="button primary" type="submit" :disabled="busy || loading">{{ busy ? '正在保存…' : '保存环境' }}<AppIcon name="check" /></button>
      </form>
      <form v-else-if="step === 'project'" class="platform-form" novalidate @submit.prevent="bind">
        <div class="platform-section-heading"><h2>绑定 NexoFolio 项目</h2><button type="button" class="inline-button" :disabled="busy || loading" @click="editScope">修改范围</button></div>
        <p class="platform-scope">{{ target.origin }}{{ prefix }}</p>
        <ProjectPicker :key="`${target.tabId}:${target.address}:${prefix}`" :disabled="busy || loading" @select="selectBindingProject" />
        <template v-if="chosen">
        <p v-if="environmentLoading" class="platform-hint" role="status">正在加载 {{ chosen.name }} 的环境…</p>
        <p v-else-if="!environmentOptions.length && !environmentListError" class="platform-hint">该项目暂无环境，可填写名称。</p>
        <div class="field">
          <Label for="project-environment">环境名称</Label>
          <InputFeedback :error="environmentError" message-id="project-environment-error" :revision="environmentRevision"><input id="project-environment" v-model="environmentName" :disabled="busy || loading" autocomplete="off" spellcheck="false" placeholder="例如 开发环境" @input="editEnvironmentName" /></InputFeedback>
          <div v-if="environmentOptions.length" class="scope-options"><button v-for="option in environmentOptions" :key="option.id" type="button" class="scope-option" :class="{ selected: option.id === environmentId }" :disabled="busy || loading" @click="chooseEnvironment(option)">{{ option.name }}</button></div>
        </div>
        <p v-if="environmentListError" class="platform-hint">{{ environmentListError }} <button type="button" class="inline-button" :disabled="environmentLoading" @click="loadEnvironments()">重新读取</button></p>
        <button v-if="environmentOptions.length < environmentTotal" type="button" class="inline-button" :disabled="environmentLoading" @click="loadEnvironments(true)">更多环境</button>
        </template>
        <p v-if="binding?.prefix === prefix" class="platform-hint">保存后，此范围改用新项目，替换 {{ binding.project.name }}。</p>
        <button class="button primary" type="submit" :disabled="busy || loading || !chosen || !environmentName.trim()">{{ busy ? '正在绑定…' : '保存绑定' }}</button>
      </form>
      <template v-else>
        <div v-if="context?.legacy" class="platform-form">
          <h2>选择此范围的项目</h2>
          <p class="platform-hint">旧版本在 {{ context.legacy.origin }}{{ context.legacy.prefix }} 绑定了多个项目，现在每个范围只对应一个项目，请选择一个。</p>
          <button v-for="project in context.legacy.projects" :key="project.id" type="button" class="binding-choice" :disabled="busy || loading" @click="chooseLegacy(project)">{{ project.name }}<template v-if="project.environmentName"> · {{ project.environmentName }}</template><AppIcon name="chevronRight" :size="15" /></button>
        </div>
        <div v-if="context?.status === 'unauthorized' && binding" class="platform-form">
          <p class="platform-hint">此站点已绑定到 {{ binding.project.name }}，插件还需要访问许可才能采集。</p>
          <button type="button" class="button primary" :disabled="busy || loading" @click="authorize">允许访问此站点<AppIcon name="arrowRight" :size="16" /></button>
        </div>
        <div v-else-if="(context?.status === 'unauthorized' || context?.status === 'unbound') && !context.legacy" class="platform-form">
          <button type="button" class="button primary" :disabled="busy || loading || context.offline" @click="editScope">绑定此站点<AppIcon name="arrowRight" :size="16" /></button>
        </div>
      </template>
    </template>
    <div v-show="context?.status === 'bound' && !step" class="capture-history">
      <CaptureFeed :snapshot="capture.snapshot.value" @retry="capture.retry" />
    </div>
  </section>
</template>
