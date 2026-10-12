<script setup lang="ts">
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger, Label } from 'reka-ui'
import { useBindingEnvironment } from '../../platforms/bindingEnvironment'
import { platformCommand } from '../../platforms/bridge'
import { SITE_CACHE_PREFIX, type LegacyProject, type Named, type PlatformCommand, type PlatformContext } from '../../platforms/contracts'
import { matchesPath, normalizeScope } from '../../platforms/scope'
import { serviceOriginPattern } from '../../auth/contracts'
import AppIcon from '../components/AppIcon.vue'
import InputFeedback from '../components/InputFeedback.vue'
import ProjectPicker from '../components/ProjectPicker.vue'
import { platformMenuKey } from '../../platforms/menu'
import { useCapture } from '../../capture/useCapture'
import CaptureFeed from '../components/CaptureFeed.vue'
import PlatformBindingCard from '../components/PlatformBindingCard.vue'
import ProjectCreationHelp from '../components/ProjectCreationHelp.vue'
import EnvironmentPicker from '../components/EnvironmentPicker.vue'
import BindingReview from '../components/BindingReview.vue'
import type { CapturedRequest } from '../../capture/contracts'
// Load the editor only when opening a record; login and capture list stay lightweight.
const RequestDetailView = defineAsyncComponent(() => import('./RequestDetailView.vue'))

// Old local bindings are still read while they wait for migration or a choice.
const LEGACY_STORAGE_PREFIX = 'nexofolio.platforms.v1:'

const context = ref<PlatformContext | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const scopeError = ref('')
const scopeRevision = ref(0)
const prefix = ref('/')
const customScope = ref(false)
const confirmed = ref(false)
const step = ref<'scope' | 'project' | 'environment' | null>(null)
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
const selectedRecord = shallowRef<CapturedRequest | null>(null)
const detailRow = computed(() => capture.snapshot.value.rows.find(row => row.recordKey === selectedRecord.value?.recordKey) || selectedRecord.value)
function openRecord(row: CapturedRequest) {
  if (!row.recordKey || step.value || context.value?.status !== 'bound') return
  selectedRecord.value = row; capture.requestDetail(row)
}
function closeRecord() {
  const key = selectedRecord.value?.recordKey
  selectedRecord.value = null; capture.requestDetail(null)
  void nextTick(() => {
    const index = capture.snapshot.value.rows.findIndex(row => row.recordKey === key)
    if (index >= 0) panelRoot.value?.querySelectorAll<HTMLButtonElement>('.request-line')[index]?.focus({ preventScroll: true })
  })
}
watch(step, value => { if (value && selectedRecord.value) closeRecord() }, { flush: 'sync' })
const platformName = computed(() => target.value?.title || (loading.value ? '读取中…' : '选择网页'))
const projectLabel = computed(() => binding.value?.project.name || (context.value?.status === 'unauthorized' ? '未授权' : '未绑定'))
const scopeOptions = computed(() => {
  const parts = (target.value?.pathname || '/').split('/').filter(Boolean)
  return parts.slice(0, 5).map((_, index) => '/' + parts.slice(0, index + 1).join('/'))
})
const reviewProject = computed(() => step.value === 'environment' ? binding.value?.project : chosen.value)
const environmentProject = computed(() => step.value === 'project' || step.value === 'environment' ? reviewProject.value?.id : undefined)
const environment = useBindingEnvironment(environmentProject)
const { name: environmentName, id: environmentId, creating: creatingEnvironment, ready: environmentReady,
  error: environmentError, revision: environmentRevision, duplicate: duplicateEnvironment } = environment
const { options: environmentOptions, total: environmentTotal, loading: environmentLoading, error: environmentListError, load: loadEnvironments } = environment.list
const reviewKey = computed(() => JSON.stringify([target.value?.windowId, target.value?.tabId, target.value?.address,
  step.value, prefix.value, reviewProject.value?.id, reviewProject.value?.name, environmentId.value, environmentName.value, creatingEnvironment.value]))
watch(reviewKey, () => { confirmed.value = false }, { flush: 'sync' })
const replacing = computed(() => binding.value?.prefix === prefix.value)
const moreSpecificBinding = computed(() => binding.value && binding.value.prefix !== prefix.value && matchesPath(binding.value.prefix, prefix.value))
const submitLabel = computed(() => moreSpecificBinding.value ? '确认保存此范围的绑定'
  : replacing.value ? '确认更换绑定并开始采集' : '确认绑定并开始采集')

function accept(next: PlatformContext, reset: boolean) {
  const changed = context.value?.page?.tabId !== next.page?.tabId || context.value?.page?.address !== next.page?.address
  const bindingChanged = JSON.stringify(context.value?.binding) !== JSON.stringify(next.binding)
  if (selectedRecord.value && (changed || bindingChanged || next.status !== 'bound')) closeRecord()
  context.value = next
  if (reset || changed) {
    prefix.value = next.binding?.prefix || '/'
    environment.reset()
    confirmed.value = false
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
function confirmScope() {
  if (!target.value || busy.value || loading.value) return
  const current = target.value
  scopeRevision.value++
  try {
    const scope = normalizeScope(current.origin, prefix.value)
    if (!matchesPath(current.pathname, scope.prefix)) throw new Error('当前页面不在这个路径范围内。')
    prefix.value = scope.prefix
  } catch (cause) { customScope.value = true; scopeError.value = cause instanceof Error ? cause.message : '请检查路径范围。'; return }
  scopeError.value = ''
  openProjectStep(prefix.value)
}
function openProjectStep(scopePrefix: string) {
  prefix.value = scopePrefix
  chosen.value = null
  environment.reset()
  confirmed.value = false
  error.value = ''
  step.value = 'project'
  void focusEditor()
}
function openScope(scopePrefix: string) {
  if (busy.value || loading.value) return
  prefix.value = scopePrefix
  customScope.value = scopePrefix !== '/'
  step.value = 'scope'
  error.value = scopeError.value = ''
  chosen.value = null
  environment.reset()
  confirmed.value = false
  void focusEditor()
}
// Every ordinary new binding starts at the whole site; editing keeps the stored scope.
function editScope() { openScope('/') }
function modifyScope() { openScope(prefix.value) }
function editProject() {
  if (busy.value || loading.value || !binding.value) return
  openProjectStep(binding.value.prefix)
}
function editEnvironment() {
  if (busy.value || loading.value || !binding.value) return
  prefix.value = binding.value.prefix
  step.value = 'environment'
  environment.reset(binding.value.environment)
  confirmed.value = false
  error.value = ''
  void focusEditor()
}
function selectBindingProject(project: Named | null) {
  if (chosen.value?.id === project?.id) return
  // The environment draft and inflight list are invalidated synchronously by project ID.
  chosen.value = project ? { id: project.id, name: project.name } : null
}
async function focusEditor() {
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLElement>('.binding-editor-heading h1')?.focus({ preventScroll: true })
}
async function back() {
  if (busy.value) return
  step.value = null
  chosen.value = null
  prefix.value = binding.value?.prefix || '/'
  error.value = scopeError.value = ''
  environment.reset()
  confirmed.value = false
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}
async function bind() {
  if (!target.value || !reviewProject.value || busy.value || loading.value || !confirmed.value || !environment.validate()) return
  const current = target.value, key = reviewKey.value, request = ++version
  const command: PlatformCommand = { type: 'platform.bind', target: current, scope: { origin: current.origin, prefix: prefix.value },
    project: { ...reviewProject.value }, environment: { id: environmentId.value, name: environmentName.value.trim() } }
  busy.value = true; error.value = ''
  // This is the only new-binding authorization/write path, directly from the confirmed click.
  const allowed = await allow(current.origin)
  if (!allowed || disposed || request !== version || key !== reviewKey.value || !confirmed.value) { settle(); return }
  await perform(command)
}
// F9: an old scope with several projects is resolved by the user, once.
function chooseLegacy(project: LegacyProject) {
  const legacy = context.value?.legacy
  if (!legacy || busy.value || loading.value) return
  openProjectStep(legacy.prefix)
  selectBindingProject(project)
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
  <section ref="panelRoot" class="platform-panel" :class="{ 'is-capture-view': !selectedRecord && !step && context?.status === 'bound', 'is-detail-view': !!selectedRecord }" :aria-labelledby="selectedRecord ? 'request-detail-title' : 'account-title'">
    <RequestDetailView v-if="selectedRecord && detailRow && target && binding && !step" :key="selectedRecord.recordKey" :row="detailRow" :detail="capture.detail.value" :target="target" :binding="binding" :disconnected="capture.snapshot.value.status === 'interrupted' || capture.snapshot.value.status === 'error'" @back="closeRecord" />
    <template v-else>
    <button v-if="step" type="button" class="back-button platform-back" :disabled="busy" @click="back"><AppIcon name="arrowLeft" :size="14" />返回</button>
    <div v-if="step" class="binding-editor-heading">
      <p class="eyebrow">{{ step === 'environment' ? '更换环境' : '站点绑定' }}</p>
      <h1 id="account-title" tabindex="-1">确认接口资料归属</h1>
      <p>让当前业务系统的接口资料进入正确的项目与环境。</p>
    </div>
    <PlatformBindingCard v-else :favicon-url="target?.faviconUrl" :platform="platformName" :project="projectLabel" :environment="binding?.environment.name" :active="capture.snapshot.value.status === 'listening'" />
    <p v-if="error" class="platform-error" role="alert">{{ error }}</p>
    <button v-if="!context && !loading" class="inline-button" type="button" @click="refresh(true)">重新读取<AppIcon name="arrowRight" :size="14" /></button>
    <p v-if="context?.status === 'unsupported'" class="platform-hint">请等待页面加载，或切换到 HTTP / HTTPS 网页。</p>
    <p v-if="context?.offline" class="platform-hint" role="status">无法连接 NexoFolio，暂按本地缓存的绑定显示。</p>
    <template v-if="target">
      <form v-if="step === 'scope'" class="platform-form binding-form" novalidate @submit.prevent="confirmScope">
        <div class="binding-site">
          <span class="binding-site-label">当前站点</span>
          <strong>{{ target.origin }}</strong>
          <div class="binding-scope-line"><AppIcon name="globe" :size="13" /><span>{{ prefix === '/' ? '整个站点' : prefix }}</span></div>
        </div>
        <CollapsibleRoot v-model:open="customScope" :disabled="busy || loading" class="scope-customization">
          <CollapsibleTrigger type="button" class="scope-customization-trigger"><span>高级设置 · 自定义路径</span><AppIcon class="disclosure-chevron" name="chevronRight" :size="14" /></CollapsibleTrigger>
          <CollapsibleContent class="binding-disclosure">
            <div class="scope-customization-content field">
              <Label for="platform-prefix">路径范围</Label>
              <p id="scope-hint" class="platform-hint">同一站点有多个业务系统时，可单独绑定路径。更具体的路径优先匹配。</p>
              <InputFeedback :error="scopeError" message-id="scope-error" :revision="scopeRevision"><input id="platform-prefix" v-model="prefix" :disabled="busy || loading" maxlength="2048" autocomplete="off" spellcheck="false" :aria-invalid="!!scopeError" :aria-describedby="scopeError ? 'scope-hint scope-error' : 'scope-hint'" @input="scopeError = ''" /></InputFeedback>
              <div class="scope-options" aria-label="建议的路径范围"><button v-for="option in ['/', ...scopeOptions]" :key="option" class="scope-option" :class="{ selected: prefix === option }" :aria-pressed="prefix === option" type="button" :disabled="busy || loading" @click="prefix = option; scopeError = ''">{{ option === '/' ? '整个站点 /' : option }}</button></div>
            </div>
          </CollapsibleContent>
        </CollapsibleRoot>
        <p class="platform-hint">绑定保存在 NexoFolio，登录同一服务的插件都会使用。已有局部绑定保持原范围。</p>
        <p v-if="moreSpecificBinding" class="platform-hint">当前页面已有更具体的 {{ binding?.prefix }} 绑定，仍会优先使用。</p>
        <ProjectCreationHelp :origin="target.origin" />
        <button class="button primary" type="submit" :disabled="busy || loading">继续选择归属<AppIcon name="arrowRight" :size="16" /></button>
      </form>
      <form v-else-if="step === 'project' || step === 'environment'" class="platform-form binding-form" novalidate @submit.prevent="bind">
        <div class="binding-site">
          <span class="binding-site-label">当前站点</span>
          <strong>{{ target.origin }}</strong>
          <div class="binding-scope-line"><AppIcon name="globe" :size="13" /><span>{{ prefix === '/' ? '整个站点' : prefix }}</span><button v-if="step === 'project'" type="button" class="inline-button" :disabled="busy || loading" @click="modifyScope">修改范围</button></div>
        </div>
        <div class="binding-project-field">
          <ProjectPicker v-if="step === 'project'" :selected-id="chosen?.id" :disabled="busy || loading" @select="selectBindingProject" />
          <div v-else class="field-intro"><span class="field-label">NexoFolio 项目</span><strong class="fixed-project">{{ binding?.project.name }}</strong><p>保持当前项目与路径范围，仅更换环境。</p></div>
          <ProjectCreationHelp :origin="target.origin" />
        </div>
        <EnvironmentPicker v-if="reviewProject" :key="environmentProject" :project="reviewProject.name" :options="environmentOptions" :total="environmentTotal" :loading="environmentLoading" :list-error="environmentListError" :environment-id="environmentId" :name="environmentName" :creating="creatingEnvironment" :duplicate="duplicateEnvironment" :error="environmentError" :revision="environmentRevision" :disabled="busy || loading" @choose="environment.reset" @create="environment.create" @cancel="environment.reset()" @rename="environment.rename" @validate="environment.validate" @load="loadEnvironments" />
        <p v-else class="platform-hint">选择项目后，再选择当前网页的实际环境。</p>
        <template v-if="reviewProject && environmentReady">
          <BindingReview v-model:checked="confirmed" :origin="target.origin" :prefix="prefix" :project="reviewProject.name" :environment="environmentName.trim()" :creating="creatingEnvironment" :disabled="busy || loading" />
          <p v-if="moreSpecificBinding" class="platform-hint">当前页面仍优先使用 {{ binding?.prefix }} 的 {{ binding?.project.name }} · {{ binding?.environment.name }} 绑定。</p>
          <p v-else-if="replacing" class="platform-hint">确认后，此范围从 {{ binding?.project.name }} · {{ binding?.environment.name }} 切换到以上归属。</p>
        </template>
        <button class="button primary" type="submit" :disabled="busy || loading || !environmentReady || !confirmed">{{ busy ? '正在确认绑定…' : submitLabel }}<AppIcon name="arrowRight" :size="15" /></button>
      </form>
      <template v-else>
        <div v-if="context?.legacy" class="platform-form">
          <h2>选择此范围的项目</h2>
          <p class="platform-hint">旧版本在 {{ context.legacy.origin }}{{ context.legacy.prefix }} 绑定了多个项目。请选择当前业务系统的项目，再核对环境与归属。</p>
          <button v-for="project in context.legacy.projects" :key="project.id" type="button" class="binding-choice" :disabled="busy || loading" @click="chooseLegacy(project)"><span>{{ project.name }}<template v-if="project.environmentName"> · {{ project.environmentName }}</template></span><AppIcon name="chevronRight" :size="15" /></button>
          <ProjectCreationHelp :origin="target.origin" />
        </div>
        <div v-if="context?.status === 'unauthorized' && binding" class="platform-form">
          <p class="platform-hint">此站点已绑定到 {{ binding.project.name }}，插件还需要访问许可才能采集。</p>
          <button type="button" class="button primary" :disabled="busy || loading" @click="authorize">允许访问此站点<AppIcon name="arrowRight" :size="16" /></button>
        </div>
        <div v-else-if="(context?.status === 'unauthorized' || context?.status === 'unbound') && !context.legacy" class="platform-form">
          <p class="platform-hint">确认当前站点的项目与环境后，开始采集接口资料。</p>
          <button type="button" class="button primary" :disabled="busy || loading || context.offline" @click="editScope">绑定此站点<AppIcon name="arrowRight" :size="16" /></button>
          <ProjectCreationHelp :origin="target.origin" />
        </div>
      </template>
    </template>
    <div v-show="context?.status === 'bound' && !step" class="capture-history">
      <CaptureFeed :snapshot="capture.snapshot.value" @retry="capture.retry" @open="openRecord" />
    </div>
    </template>
  </section>
</template>
