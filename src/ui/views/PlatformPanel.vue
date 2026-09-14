<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue'
import { Label } from 'reka-ui'
import { platformCommand } from '../../platforms/bridge'
import { PLATFORM_STORAGE_PREFIX, type BoundProject, type PlatformCommand, type PlatformContext } from '../../platforms/contracts'
import { matchesPath, normalizeScope } from '../../platforms/scope'
import { serviceOriginPattern } from '../../auth/contracts'
import AppIcon from '../components/AppIcon.vue'
import InputFeedback from '../components/InputFeedback.vue'
import ProjectPicker from '../components/ProjectPicker.vue'
import { platformMenuKey } from '../../platforms/menu'
import { useCapture } from '../../capture/useCapture'
import CaptureFeed from '../components/CaptureFeed.vue'

const context = ref<PlatformContext | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const scopeError = ref('')
const scopeRevision = ref(0)
const prefix = ref('/')
const draftName = ref('')
const nameError = ref('')
const nameRevision = ref(0)
const step = ref<'scope' | 'project' | 'name' | null>(null)
const chosen = ref<BoundProject | null>(null)
const panelRoot = ref<HTMLElement>()
const menu = inject(platformMenuKey, null)
const menuOwner = Symbol('active-platform')
let windowId: number | undefined
let version = 0
let disposed = false
let refreshPending = false
let timer: ReturnType<typeof setTimeout> | undefined

const target = computed(() => context.value?.page ?? null)
// Subscribe to history for the lifetime of the logged-in panel. The background
// independently gates new capture by the active page authorization and binding.
const capture = useCapture()
const platformName = computed(() => context.value?.rule?.name || target.value?.title || (loading.value ? '读取中…' : '选择网页'))
const projectLabel = computed(() => context.value?.selected?.name || (context.value?.status === 'ambiguous' ? '待选择' : context.value?.status === 'unauthorized' ? '未授权' : '未绑定'))
const scopeOptions = computed(() => {
  const parts = (target.value?.pathname || '/').split('/').filter(Boolean)
  return ['/', ...parts.slice(0, 5).map((_, index) => '/' + parts.slice(0, index + 1).join('/'))]
})

function accept(next: PlatformContext, reset: boolean) {
  const changed = context.value?.page?.tabId !== next.page?.tabId || context.value?.page?.address !== next.page?.address
  context.value = next
  if (reset || changed) {
    prefix.value = next.rule?.prefix || '/'
    draftName.value = (next.rule?.name || next.page?.title || '').slice(0, 100)
    nameError.value = ''
    chosen.value = null
    scopeError.value = ''
    step.value = next.status === 'unauthorized' ? 'scope' : next.status === 'unbound' ? 'project' : null
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
    if (!disposed && request === version) { context.value = null; error.value = cause instanceof Error ? cause.message : '无法读取当前平台。' }
  } finally { if (request === version) loading.value = false }
}
function scheduleRefresh() {
  if (disposed) return
  loading.value = true
  ++version
  clearTimeout(timer)
  timer = setTimeout(() => void refresh(true), 80)
}
async function perform(command: PlatformCommand) {
  const request = ++version
  busy.value = true
  error.value = ''
  try {
    const next = await platformCommand(command)
    if (disposed || request !== version) return
    accept(next, true)
    if (command.type === 'platform.authorize') {
      // Continue binding the scope the user selected, even if a more specific rule matches this page.
      prefix.value = command.scope.prefix
      chosen.value = null
      step.value = 'project'
    }
    if (command.type === 'platform.rename') step.value = null
  } catch (cause) {
    if (!disposed && request === version) error.value = cause instanceof Error ? cause.message : '操作失败，请重试。'
  } finally {
    busy.value = false
    if (refreshPending) { refreshPending = false; void refresh(true) }
  }
}
async function authorize() {
  if (!target.value || busy.value || loading.value) return
  if (!validateName()) return
  const current = { ...target.value }
  let scope
  scopeRevision.value++
  try {
    scope = normalizeScope(current.origin, prefix.value)
    if (!matchesPath(current.pathname, scope.prefix)) throw new Error('当前页面不在这个路径范围内。')
  } catch (cause) { scopeError.value = cause instanceof Error ? cause.message : '请检查路径范围。'; return }
  scopeError.value = ''
  busy.value = true
  error.value = ''
  try {
    // Native permission must originate from this user gesture. Product consent is saved separately.
    const allowed = await chrome.permissions.request({ origins: [serviceOriginPattern(current.origin)] })
    if (!allowed) { error.value = '未获得访问许可。'; return }
    busy.value = false
    await perform({ type: 'platform.authorize', target: current, scope, name: draftName.value.trim() })
  } catch { error.value = '无法获取访问许可，请重试。' }
  finally { busy.value = false; if (refreshPending) { refreshPending = false; void refresh(true) } }
}
function editScope() {
  if (busy.value || loading.value) return
  prefix.value = target.value?.pathname || '/'
  draftName.value = platformName.value.slice(0, 100)
  nameError.value = ''
  step.value = 'scope'
  error.value = scopeError.value = ''
  chosen.value = null
  void focusEditor()
}
function editName() {
  if (busy.value || loading.value) return
  if (!context.value?.rule) { editScope(); return }
  draftName.value = platformName.value.slice(0, 100)
  nameError.value = error.value = ''
  step.value = 'name'
  void focusEditor()
}
function validateName() {
  nameRevision.value++
  nameError.value = draftName.value.trim() ? '' : '请输入平台名称'
  return !nameError.value
}
function rename() {
  if (!target.value || !context.value?.rule || busy.value || loading.value || !validateName()) return
  void perform({ type: 'platform.rename', target: target.value, ruleId: context.value.rule.id, name: draftName.value.trim() })
}
function editProjects() {
  if (busy.value || loading.value) return
  step.value = 'project'
  prefix.value = context.value?.rule?.prefix || '/'
  chosen.value = null
  error.value = ''
  void focusEditor()
}
async function focusEditor() {
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLInputElement>('form input')?.focus()
}
async function back() {
  if (busy.value) return
  step.value = null
  chosen.value = null
  prefix.value = context.value?.rule?.prefix || '/'
  error.value = scopeError.value = ''
  nameError.value = ''
  await nextTick()
  if (!disposed) panelRoot.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}
function bind() {
  if (!target.value || !chosen.value || busy.value || loading.value) return
  void perform({ type: 'platform.bind', target: target.value, scope: { origin: target.value.origin, prefix: prefix.value }, project: chosen.value })
}
function choose(project: BoundProject) {
  if (!target.value || !context.value?.rule || busy.value || loading.value) return
  void perform({ type: 'platform.select', target: target.value, ruleId: context.value.rule.id, projectId: project.id })
}
function unbind() {
  if (!target.value || !context.value?.rule || !context.value.selected || busy.value || loading.value) return
  void perform({ type: 'platform.unbind', target: target.value, ruleId: context.value.rule.id, projectId: context.value.selected.id })
}
watchEffect(() => {
  if (!menu || disposed) return
  menu.value = {
    owner: menuOwner,
    busy: busy.value || loading.value,
    canEditProjects: !!context.value?.rule?.authorized && context.value.status !== 'unauthorized',
    canEditScope: !!target.value,
    canEditName: !!target.value,
    canUnbind: !!context.value?.selected,
    editProjects, editScope, editName, unbind,
  }
})
const activated = (info: chrome.tabs.TabActiveInfo) => { if (info.windowId === windowId) scheduleRefresh() }
const updated = (_id: number, changes: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
  if (tab.windowId === windowId && tab.active && (changes.url !== undefined || changes.status === 'complete')) scheduleRefresh()
}
const removed = (tabId: number) => { if (tabId === target.value?.tabId) scheduleRefresh() }
const storageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith(PLATFORM_STORAGE_PREFIX)) && !busy.value) scheduleRefresh()
}
const permissionsChanged = () => { if (!busy.value) scheduleRefresh() }
const visible = () => { if (document.visibilityState === 'visible') scheduleRefresh() }
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
  <section ref="panelRoot" class="platform-panel" aria-labelledby="account-title">
    <button v-if="step" type="button" class="back-button platform-back" :disabled="busy" @click="back"><AppIcon name="arrowLeft" :size="14" />返回</button>
    <div class="platform-relation">
      <div class="platform-relation-side"><span>当前平台</span><h1 id="account-title" tabindex="-1" :title="platformName">{{ platformName }}</h1></div>
      <AppIcon name="arrowRight" :size="14" />
      <div class="platform-relation-side"><span>绑定项目</span><strong :title="projectLabel">{{ projectLabel }}</strong></div>
    </div>
    <p v-if="error" class="platform-error" role="alert">{{ error }}</p>
    <button v-if="!context && !loading" class="inline-button" type="button" @click="refresh(true)">重新读取<AppIcon name="arrowRight" :size="14" /></button>
    <p v-if="context?.status === 'unsupported'" class="platform-hint">请等待页面加载，或切换到 HTTP / HTTPS 网页。</p>
    <template v-if="target">
      <form v-if="step === 'scope'" class="platform-form" novalidate @submit.prevent="authorize">
        <h2>授权此平台</h2>
        <div class="field">
          <Label for="platform-name">平台名称</Label>
          <InputFeedback :error="nameError" message-id="platform-name-error" :revision="nameRevision"><input id="platform-name" v-model="draftName" :disabled="busy || loading" maxlength="100" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'platform-name-error' : undefined" @input="nameError = ''" /></InputFeedback>
        </div>
        <div class="field">
          <Label for="platform-prefix">路径范围</Label>
          <InputFeedback :error="scopeError" message-id="scope-error" :revision="scopeRevision"><input id="platform-prefix" v-model="prefix" :disabled="busy || loading" maxlength="2048" :aria-invalid="!!scopeError" :aria-describedby="scopeError ? 'scope-error' : undefined" @input="scopeError = ''" /></InputFeedback>
          <div class="scope-options"><button v-for="option in scopeOptions" :key="option" class="scope-option" :class="{ selected: prefix === option }" type="button" :disabled="busy || loading" @click="prefix = option; scopeError = ''">{{ option === '/' ? '整个站点 /' : option }}</button></div>
        </div>
        <p class="platform-hint">更具体的路径优先匹配。浏览器许可覆盖主机，插件按此范围管理平台归属。</p>
        <p v-if="context?.rule && prefix.length < context.rule.prefix.length" class="platform-hint">此页面已有更具体的 {{ context.rule.prefix }} 规则，仍会优先使用该规则。</p>
        <button class="button primary" type="submit" :disabled="busy || loading">{{ busy ? '正在授权…' : '授权并选择项目' }}<AppIcon name="arrowRight" /></button>
      </form>
      <form v-else-if="step === 'name'" class="platform-form" novalidate @submit.prevent="rename">
        <h2>修改平台名称</h2>
        <div class="field">
          <Label for="platform-name">平台名称</Label>
          <InputFeedback :error="nameError" message-id="platform-name-error" :revision="nameRevision"><input id="platform-name" v-model="draftName" :disabled="busy || loading" maxlength="100" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'platform-name-error' : undefined" @input="nameError = ''" /></InputFeedback>
        </div>
        <button class="button primary" type="submit" :disabled="busy || loading">{{ busy ? '正在保存…' : '保存名称' }}<AppIcon name="check" :size="16" /></button>
      </form>
      <form v-else-if="step === 'project'" class="platform-form" novalidate @submit.prevent="bind">
        <div class="platform-section-heading"><h2>绑定 NexoFolio 项目</h2><button type="button" class="inline-button" :disabled="busy || loading" @click="editScope">修改范围</button></div>
        <p class="platform-scope">{{ target.origin }}{{ prefix }}</p>
        <ProjectPicker :key="`${target.tabId}:${target.address}:${prefix}`" :disabled="busy || loading" @select="chosen = $event" />
        <p v-if="context?.rule?.prefix === prefix && context.rule.projects.length" class="platform-hint">添加项目不会覆盖此范围已有的绑定。</p>
        <button class="button primary" type="submit" :disabled="busy || loading || !chosen">{{ busy ? '正在绑定…' : '保存绑定' }}<AppIcon name="check" /></button>
      </form>
      <div v-else-if="context?.status === 'ambiguous'" class="platform-form">
        <h2>选择当前项目</h2>
        <p class="platform-hint">此范围绑定了多个项目，请选择本标签页使用的项目。</p>
        <button v-for="project in context.rule?.projects" :key="project.id" type="button" class="binding-choice" :disabled="busy || loading" @click="choose(project)">{{ project.name }}<AppIcon name="chevronRight" :size="15" /></button>
      </div>
      <div v-else-if="context?.status === 'bound' && (context.rule?.projects.length || 0) > 1" class="platform-form">
        <div v-if="(context.rule?.projects.length || 0) > 1" class="binding-switches"><button v-for="project in context.rule?.projects" :key="project.id" type="button" class="scope-option" :class="{ selected: project.id === context.selected?.id }" :disabled="busy || loading" @click="choose(project)">{{ project.name }}</button></div>
      </div>
      <div v-else-if="context?.status === 'unauthorized' || context?.status === 'unbound'" class="platform-form">
        <button type="button" class="button primary" :disabled="busy || loading" @click="context.status === 'unauthorized' ? editScope() : editProjects()">{{ context.status === 'unauthorized' ? '授权并绑定' : '选择绑定项目' }}<AppIcon name="arrowRight" :size="16" /></button>
      </div>
    </template>
    <div class="capture-history">
      <CaptureFeed :snapshot="capture.snapshot.value" :detail="capture.detail.value" @select="capture.requestDetail" @retry="capture.retry" />
    </div>
  </section>
</template>
