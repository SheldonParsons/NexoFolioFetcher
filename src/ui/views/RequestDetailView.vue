<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { CheckboxIndicator, CheckboxRoot, CollapsibleContent, CollapsibleRoot, CollapsibleTrigger, Label, TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { CaptureDetail, CapturedRequest } from '../../capture/contracts'
import type { PageTarget, SiteBinding } from '../../platforms/contracts'
import { formatHeaderLines } from '../../replay/headerLines'
import { createDraft, draftUrl, parseUrl, payloadFrom, setBodyMode, type BodyMode, type DraftPair, type RequestDraft } from '../../replay/draft'
import { useReplay } from '../../replay/useReplay'
import { useUpdates } from '../../updates/useUpdates'
import AppIcon from '../components/AppIcon.vue'
import RequestSelect from '../components/request/RequestSelect.vue'
import KeyValueEditor from '../components/request/KeyValueEditor.vue'
import CodeEditor from '../components/request/CodeEditor.vue'

const props = defineProps<{ row: CapturedRequest; detail: CaptureDetail | null; target: PageTarget; binding: SiteBinding; disconnected: boolean }>()
const emit = defineEmits<{ back: [] }>()
const root = ref<HTMLElement>(), draft = ref<RequestDraft | null>(null), dirty = ref(false), contextOpen = ref(false)
const focusedPane = ref<'request' | 'response' | null>(null)
const requestTab = ref('params'), responseTab = ref('body'), requestSource = ref('draft'), responseSource = ref('original'), targetConfirmed = ref(false)
const sourceChoices = [{ value: 'draft', label: '编辑草稿' }, { value: 'original', label: '原始采集' }]
const responseChoices = [{ value: 'sent', label: '发送结果' }, { value: 'original', label: '原始采集' }]
const bodyChoices = [{ value: 'none', label: '无正文' }, { value: 'json', label: 'JSON' }, { value: 'text', label: '原始文本' }, { value: 'form', label: 'URL 编码表单' }, { value: 'base64', label: 'Base64 二进制' }]
const url = computed(() => draft.value ? draftUrl(draft.value.url) : props.detail?.request?.url || props.row.url)
const reference = computed(() => ({ id: props.row.id, recordKey: props.row.recordKey, target: props.target }))
const replay = useReplay(reference, url), updates = useUpdates()
const { inspection, inspecting, result, busy, connected, granting, cancelling, phase, error, sentRequest } = replay
const available = computed(() => !!props.detail?.request && !!props.detail.source && props.detail.recordKey === props.row.recordKey && !props.disconnected)
const originalRequest = computed(() => props.detail?.request)
const originalParams = computed(() => parseUrl(originalRequest.value?.url || props.row.url).pairs)
const manyParams = computed(() => (requestSource.value === 'draft' ? draft.value?.url : parseUrl(originalRequest.value?.url || props.row.url))?.rawQuery !== undefined)
const originalHeaders = computed(() => formatHeaderLines(originalRequest.value?.headers.entries || []))
const response = computed(() => responseSource.value === 'original' ? props.detail?.response : result.value?.response)
const responseHeaders = computed(() => formatHeaderLines(response.value?.headers.entries || []))
const responseLanguage = computed(() => response.value?.encoding === 'base64' ? 'base64' : /json/i.test(response.value?.contentType || '') ? 'json' : 'text')
const originalLanguage = computed(() => originalRequest.value?.body.encoding === 'base64' ? 'base64' : /json/i.test(originalRequest.value?.body.contentType || '') ? 'json' : 'text')
const bodyOptions = computed(() => draft.value?.bodyMode === 'unavailable' ? [{ value: 'unavailable', label: '正文待重建', disabled: true }, ...bodyChoices] : bodyChoices)
const validation = computed(() => {
  if (!draft.value) return ''
  try { payloadFrom(draft.value); return '' } catch (cause) { return cause instanceof Error ? cause.message : '请检查请求草稿。' }
})
const canSend = computed(() => available.value && !!draft.value && !busy.value && !granting.value && !inspecting.value && updates.state.value.allowed
  && !!inspection.value && !inspection.value.needsPermission && !validation.value && (!inspection.value.changedTarget || targetConfirmed.value))
const statusMessage = computed(() => {
  if (busy.value) return cancelling.value ? '正在取消等待…' : phase.value
  if (props.disconnected) return '详情通道已断开，原始引用不可用。请返回列表重新连接。'
  if (props.detail && !props.detail.request) return '原始记录已被淘汰或后台已重启，无法继续发送。'
  if (!updates.state.value.allowed) return '版本尚未通过校验，手动发送已停用。'
  if (error.value) return error.value
  if (!available.value) return '正在读取这条记录的原始内容…'
  if (validation.value) return validation.value
  if (inspecting.value) return '正在核对站点、项目、环境和目标权限…'
  if (inspection.value?.needsPermission) return `发送前需授权目标站点 ${inspection.value.origin}`
  if (inspection.value?.changedTarget && !targetConfirmed.value) return '目标域名或已登记环境已变化，请先展开下方目标信息核对。'
  return '就绪 · 仅在点击发送后执行一次，不自动重试或上传。'
})
const responseEmpty = computed(() => {
  if (responseSource.value === 'sent') return busy.value ? phase.value : result.value?.message || '编辑请求后点击「发送」，结果会显示在这里。'
  return ['pending', 'reading'].includes(props.detail?.response?.state || '') ? '原始响应仍在采集中…' : '原始记录没有可读取的响应正文。'
})
const responseSize = computed(() => response.value ? `${(response.value.bytes / 1024).toFixed(1)} KiB` : '—')
const sameBinding = computed(() => {
  const destination = props.detail?.source?.destination
  return !!destination && destination.projectId === props.binding.project.id && ('id' in destination.environment
    ? destination.environment.id === props.binding.environment.id : destination.environment.name === props.binding.environment.name)
})
const resultOutdated = computed(() => {
  if (!draft.value || !sentRequest.value) return false
  try { return JSON.stringify(payloadFrom(draft.value)) !== JSON.stringify(sentRequest.value) } catch { return true }
})

watch(() => props.detail, detail => {
  if (!detail?.request || detail.recordKey !== props.row.recordKey) return
  // Late capture updates may fill an untouched draft, never overwrite the user's edits.
  if (!draft.value || !dirty.value) draft.value = createDraft(props.row, detail)
}, { immediate: true })
watch(inspection, value => {
  targetConfirmed.value = false
  if (value?.changedTarget) contextOpen.value = true
  if (draft.value && !value?.credentialsAllowed) draft.value.credentials = 'omit'
})
function edit(action: (value: RequestDraft) => void) { if (draft.value && !busy.value) { dirty.value = true; action(draft.value) } }
function editUrl(value: string) { edit(draft => { draft.url = parseUrl(value); draft.urlNeedsReplacement = false }) }
function updatePairs(section: 'params' | 'form', rows: DraftPair[]) {
  edit(draft => { if (section === 'params') draft.url.pairs = rows; else draft[section] = rows })
}
function reset() {
  if (!props.detail?.request || busy.value) return
  draft.value = createDraft(props.row, props.detail); dirty.value = false; targetConfirmed.value = false; requestSource.value = 'draft'
}
function send() {
  if (!draft.value || !canSend.value) return
  try { if (replay.send(payloadFrom(draft.value), targetConfirmed.value)) { responseSource.value = 'sent'; if (focusedPane.value) focusedPane.value = 'response' } }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '请检查请求草稿。' }
}
onMounted(async () => { await nextTick(); root.value?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }) })
</script>

<template>
  <section ref="root" class="request-detail-view" aria-labelledby="request-detail-title">
    <header class="debug-header">
      <div class="debug-title-row">
        <button type="button" class="debug-back" title="返回列表，本地草稿不保存" @click="emit('back')"><AppIcon name="arrowLeft" :size="14" />列表</button>
        <h1 id="request-detail-title" tabindex="-1">接口详情</h1><span class="debug-local">本地调试</span>
      </div>
      <form class="debug-request-bar" @submit.prevent="send">
        <span class="debug-method" :title="`原始请求方法：${row.method}，不可更改`">{{ row.method }}</span>
        <button v-if="busy" class="debug-send debug-cancel" type="button" :disabled="cancelling" @click="replay.cancel">{{ cancelling ? '取消中…' : '取消等待' }}</button>
        <button v-else class="debug-send" type="submit" :disabled="!canSend">发送<AppIcon name="arrowRight" :size="13" /></button>
        <input class="debug-url" :value="url" :disabled="!draft || busy" aria-label="完整请求 URL，本地草稿" placeholder="https://…" spellcheck="false" autocomplete="off" @keydown.enter.prevent @input="editUrl(($event.target as HTMLInputElement).value)" />
      </form>
      <p class="debug-status" role="status">{{ statusMessage }}</p>
      <div v-if="!busy && (inspection?.needsPermission || error)" class="debug-recovery">
        <button v-if="inspection?.needsPermission" type="button" :disabled="granting" @click="replay.grant">{{ granting ? '等待授权…' : '授权此目标站点' }}</button>
        <button v-if="error" type="button" :disabled="inspecting" @click="connected ? replay.inspect() : replay.connect()">{{ connected ? '重新核对' : '重新连接' }}</button>
      </div>
      <CollapsibleRoot v-model:open="contextOpen" class="debug-context">
        <CollapsibleTrigger class="debug-context-trigger" type="button"><span>{{ !detail?.source ? '读取采集概况…' : sameBinding ? `${binding.project.name} · ${binding.environment.name}` : '原始采集归属与当前页面不同' }}</span><AppIcon class="disclosure-chevron" name="chevronRight" :size="12" /></CollapsibleTrigger>
        <CollapsibleContent class="binding-disclosure">
          <div class="debug-context-content">
            <dl>
              <div><dt>采集来源</dt><dd>{{ detail?.source?.pageUrl || '等待详情' }}</dd></div>
              <div v-if="detail?.source && !sameBinding"><dt>原始归属</dt><dd>项目 {{ detail.source.destination.projectId }}<br />环境 {{ 'id' in detail.source.destination.environment ? detail.source.destination.environment.id : detail.source.destination.environment.name }}</dd></div>
              <div><dt>原始请求</dt><dd>{{ row.method }} {{ originalRequest?.url || row.url }}</dd></div>
              <div><dt>采集时间</dt><dd>{{ new Date(row.time).toLocaleString() }} · {{ row.type }} · {{ row.frame === 'iframe' ? 'iframe' : '主页面' }}</dd></div>
              <div v-if="inspection"><dt>发送目标</dt><dd>{{ inspection.origin }}<br />{{ inspection.binding ? `${inspection.binding.project.name} · ${inspection.binding.environment.name}` : '该接口地址无独立站点登记，不推断环境' }}</dd></div>
            </dl>
            <p>后台直接发送。草稿与结果仅保留在本次详情中，不修改原始记录、不加入采集上传。</p>
            <p>浏览器会管理部分 Headers，可能合并重复头；不复刻页面 Service Worker、Origin / Referer 或文件上传过程。文本按 UTF-8 发送。最多等待 25 秒，不自动跟随重定向。</p>
            <div v-if="draft" class="debug-check-row">
              <CheckboxRoot id="request-credentials" class="remember-checkbox" :model-value="draft.credentials === 'include'" :disabled="busy || !inspection?.credentialsAllowed" @update:model-value="edit(draft => { draft.credentials = $event === true ? 'include' : 'omit' })"><CheckboxIndicator><AppIcon name="check" :size="11" /></CheckboxIndicator></CheckboxRoot>
              <Label for="request-credentials">携带此目标的浏览器凭据（受 Cookie 策略限制）</Label>
            </div>
            <p v-if="draft?.credentials === 'omit'">默认不携带浏览器 Cookie；可编辑请求中的业务 Authorization。</p>
            <div v-if="inspection?.changedTarget" class="debug-check-row">
              <CheckboxRoot id="request-target-confirmation" class="remember-checkbox" :model-value="targetConfirmed" :disabled="busy" @update:model-value="targetConfirmed = $event === true"><CheckboxIndicator><AppIcon name="check" :size="11" /></CheckboxIndicator></CheckboxRoot>
              <Label for="request-target-confirmation">我已核对新的目标系统及业务凭据，不沿用浏览器凭据</Label>
            </div>
          </div>
        </CollapsibleContent>
      </CollapsibleRoot>
    </header>

    <div class="debug-workspace" :class="{ focused: !!focusedPane }">
      <section v-show="focusedPane !== 'response'" class="debug-pane" aria-label="请求编辑">
        <div class="debug-pane-heading"><h2>请求</h2><span v-if="dirty" class="draft-indicator">已编辑</span><button v-if="dirty" class="debug-reset" type="button" :disabled="busy || !available" @click="reset">恢复原始</button><button class="debug-reset" type="button" :aria-pressed="focusedPane === 'request'" @click="focusedPane = focusedPane === 'request' ? null : 'request'">{{ focusedPane === 'request' ? '还原布局' : '放大' }}</button><RequestSelect v-model="requestSource" compact label="请求来源" :options="sourceChoices" /></div>
        <TabsRoot v-model="requestTab" class="debug-tabs">
          <TabsList class="debug-tab-list" aria-label="请求内容"><TabsTrigger value="params">参数</TabsTrigger><TabsTrigger value="headers">Headers</TabsTrigger><TabsTrigger value="body">Body</TabsTrigger></TabsList>
          <TabsContent value="params" class="debug-tab-content">
            <p v-if="requestSource === 'draft'" class="debug-note">与上方 URL 同步，保留重复键与空值。</p>
            <p v-if="manyParams" class="debug-empty">参数超过 256 项，完整内容保留在 URL 中，请在上方 URL 栏编辑；原始 URL 可在概况中查看。</p>
            <KeyValueEditor v-else-if="draft" :rows="requestSource === 'draft' ? draft.url.pairs : originalParams" label="Query 参数" :readonly="requestSource === 'original'" :disabled="busy" @change="updatePairs('params', $event)" />
          </TabsContent>
          <TabsContent value="headers" class="debug-tab-content">
            <p class="debug-note">{{ requestSource === 'original' ? originalRequest?.headers.message || '仅原始页面可见的请求头。' : '每行「名称: 值」，行首加「# 」停用；保留重复项和空值。' }}</p>
            <p v-if="requestSource === 'draft' && draft?.headersNote" class="debug-note">{{ draft.headersNote }}</p>
            <CodeEditor v-if="draft" :key="requestSource" :model-value="requestSource === 'draft' ? draft.headersText : originalHeaders" :label="requestSource === 'draft' ? '请求 Headers，每行名称冒号值' : '原始请求 Headers，只读'" language="headers" :readonly="requestSource === 'original'" :disabled="busy" @update:model-value="edit(draft => { draft.headersText = $event })" />
          </TabsContent>
          <TabsContent value="body" class="debug-tab-content">
            <template v-if="requestSource === 'original' && originalRequest">
              <p class="debug-note">{{ originalRequest.body.message || (originalRequest.body.state === 'none' ? '原始请求无正文。' : `原始采集 · ${originalRequest.body.bytes} bytes`) }}</p>
              <CodeEditor v-if="originalRequest.body.body" :model-value="originalRequest.body.body" label="原始请求正文，只读" readonly :language="originalLanguage" />
            </template>
            <template v-else-if="draft">
              <div class="debug-body-tools"><RequestSelect :model-value="draft.bodyMode" label="请求正文类型" :options="bodyOptions" :disabled="busy" @update:model-value="edit(draft => setBodyMode(draft, $event as BodyMode))" /><span>最多 1 MiB</span></div>
              <p v-if="draft.bodyNote" class="debug-note">{{ draft.bodyNote }}</p>
              <p v-if="draft.bodyMode === 'none'" class="debug-empty">本次请求不携带正文。</p>
              <p v-else-if="draft.bodyMode === 'unavailable'" class="debug-empty">请选择正文类型并手动重建；multipart 的字段预览不包含文件字节，可在「原始采集」中查看。</p>
              <KeyValueEditor v-else-if="draft.bodyMode === 'form'" :rows="draft.form" label="表单字段" :disabled="busy" @change="updatePairs('form', $event)" />
              <CodeEditor v-else :model-value="draft.text" label="请求正文，本地编辑" :disabled="busy" :language="draft.bodyMode === 'json' ? 'json' : draft.bodyMode === 'base64' ? 'base64' : 'text'" @update:model-value="edit(draft => { draft.text = $event })" />
            </template>
          </TabsContent>
        </TabsRoot>
      </section>

      <section v-show="focusedPane !== 'request'" class="debug-pane debug-response" aria-label="响应结果">
        <div class="debug-pane-heading"><h2>响应</h2><button class="debug-reset" type="button" :aria-pressed="focusedPane === 'response'" @click="focusedPane = focusedPane === 'response' ? null : 'response'">{{ focusedPane === 'response' ? '还原布局' : '放大' }}</button><RequestSelect v-model="responseSource" compact label="响应来源" :options="responseChoices" /></div>
        <div class="debug-response-stats"><span><small>状态</small><strong>{{ response?.status ? `HTTP ${response.status}` : '—' }}</strong></span><span><small>耗时</small><strong>{{ responseSource === 'sent' && result?.elapsedMs ? `${result.elapsedMs} ms` : '—' }}</strong></span><span><small>大小</small><strong>{{ responseSize }}</strong></span></div>
        <TabsRoot v-model="responseTab" class="debug-tabs">
          <TabsList class="debug-tab-list" aria-label="响应内容"><TabsTrigger value="body">Body</TabsTrigger><TabsTrigger value="headers">Headers</TabsTrigger></TabsList>
          <TabsContent value="body" class="debug-tab-content">
            <p v-if="responseSource === 'sent' && sentRequest" class="debug-note debug-sent-url" :title="sentRequest.url">{{ sentRequest.method }} {{ sentRequest.url }}<template v-if="resultOutdated"><br />草稿已变化，以下仍为上次发送的结果。</template></p>
            <p v-if="responseSource === 'sent' && result && (result.state !== 'response' || !response?.status)" class="debug-note" role="status">{{ result.message }}</p>
            <p v-if="response?.message" class="debug-note">{{ response.message }}</p>
            <CodeEditor v-if="response?.body" :key="responseSource" :model-value="response.body" :label="responseSource === 'original' ? '原始响应正文，只读' : '本次响应正文，只读'" readonly :language="responseLanguage" />
            <p v-else class="debug-empty">{{ response?.state === 'complete' && response.status ? '响应正文为空。' : responseEmpty }}</p>
          </TabsContent>
          <TabsContent value="headers" class="debug-tab-content"><p class="debug-note">{{ response?.headers.message || '尚未取得响应头。' }}</p><CodeEditor :key="responseSource" :model-value="responseHeaders" label="响应 Headers，只读" language="headers" readonly /></TabsContent>
        </TabsRoot>
      </section>
    </div>
  </section>
</template>

<style scoped>
.request-detail-view { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; overflow: hidden; }
.debug-header { flex-shrink: 0; padding-bottom: 12px; }
.debug-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.debug-back { display: inline-flex; align-items: center; gap: 4px; padding: 4px 0; border: 0; border-radius: 4px; background: none; color: #777; font-size: 11px; }
.debug-title-row h1 { margin: 0; font-size: 13px; letter-spacing: 0; font-weight: 550; }
.debug-local { margin-left: auto; color: #888; font-size: 9px; }
.debug-request-bar { display: grid; grid-template-columns: auto 1fr; gap: 7px; }
.debug-method { display: inline-flex; align-items: center; justify-content: center; min-width: 54px; max-width: 130px; min-height: 34px; padding: 7px 10px; border-radius: 6px; background: #f2f2f2; color: #444; font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.debug-send { display: flex; align-items: center; justify-content: center; justify-self: end; gap: 9px; min-width: 80px; min-height: 34px; border: 1px solid #222; border-radius: 7px; background: #222; color: #fff; font-size: 11px; }
.debug-send:disabled { border-color: #e5e5e5; background: #e5e5e5; color: #999; }
.debug-cancel { border-color: #ccc; background: #fff; color: #444; }
.debug-url { grid-column: 1 / -1; height: 36px; padding: 8px 10px; border-radius: 7px; font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
.debug-url:focus { outline: none; border-color: #888; box-shadow: 0 0 0 2px #00000008; }
.debug-status { margin: 8px 0 3px; max-height: 50px; overflow: auto; color: #777; font-size: 10px; line-height: 1.7; overflow-wrap: anywhere; }
.debug-recovery { display: flex; gap: 10px; }
.debug-recovery button { border: 0; padding: 3px 0; background: none; color: #333; font-size: 10px; text-decoration: underline; text-underline-offset: 3px; }
.debug-context-trigger { display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px; border: 0; border-radius: 4px; padding: 5px 0; color: #888; background: transparent; font-size: 10px; text-align: left; }
.debug-context-trigger span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.debug-context-content { max-height: 180px; overflow: auto; padding: 8px 10px; border-radius: 7px; background: #f7f7f7; color: #777; font-size: 10px; line-height: 1.7; scrollbar-width: thin; }
.debug-context-content dl { display: grid; gap: 8px; margin: 0 0 10px; }
.debug-context-content dl > div { display: grid; grid-template-columns: 45px minmax(0, 1fr); gap: 8px; }
.debug-context-content dd { margin: 0; color: #444; overflow-wrap: anywhere; }
.debug-context-content p { margin: 8px 0; }
.debug-check-row { display: flex; align-items: flex-start; gap: 7px; margin: 10px 0; }
.debug-check-row label { flex: 1; cursor: pointer; color: #555; }
.debug-check-row .remember-checkbox { width: 15px; height: 15px; margin-top: 1px; border-radius: 4px; }
.debug-workspace { display: grid; flex: 1; min-height: 0; grid-template-rows: minmax(210px, 1fr) minmax(250px, 1.15fr); gap: 14px; padding: 0 0 12px; overflow: auto; scrollbar-width: thin; }
.debug-workspace.focused { grid-template-rows: minmax(0, 1fr); }
.debug-workspace.focused .debug-response { padding-top: 0; border-top: 0; }
.debug-pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; container-type: inline-size; container-name: request-pane; }
.debug-pane-heading { display: flex; align-items: center; gap: 7px; min-height: 28px; flex-shrink: 0; }
.debug-pane-heading h2 { margin: 0; font-size: 12px; font-weight: 600; }
.debug-pane-heading > :last-child { margin-left: auto; }
.draft-indicator { color: #888; font-size: 9px; }
.debug-reset { padding: 3px; border: 0; border-radius: 4px; background: transparent; color: #777; font-size: 9px; }
.debug-tabs { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; }
.debug-tab-list { display: flex; flex-shrink: 0; gap: 16px; border-bottom: 1px solid #e6e6e6; }
.debug-tab-list > button { position: relative; padding: 8px 1px; border: 0; background: transparent; color: #888; font-size: 11px; }
.debug-tab-list > button[data-state='active'] { color: #222; }
.debug-tab-list > button[data-state='active']::after { position: absolute; bottom: -1px; left: 0; right: 0; height: 2px; border-radius: 2px; background: #333; content: ''; }
.debug-tab-content { display: flex; flex: 1; flex-direction: column; min-height: 0; min-width: 0; gap: 7px; padding-top: 9px; outline: none; }
.debug-tab-content:focus-visible { outline: 1px solid #aaa; outline-offset: -1px; }
.debug-tab-content[data-state='inactive'] { display: none; }
.debug-note { margin: 0; max-height: 48px; overflow: auto; flex-shrink: 0; color: #888; font-size: 10px; line-height: 1.7; overflow-wrap: anywhere; }
.debug-sent-url { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.debug-body-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
.debug-body-tools > span { color: #999; font-size: 9px; }
.debug-body-tools > :first-child { min-height: 28px; font-size: 10px; }
.debug-empty { margin: auto 0; padding: 12px 0; color: #999; font-size: 11px; line-height: 1.9; text-align: center; }
.debug-response { padding-top: 10px; border-top: 1px solid #ddd; }
.debug-response-stats { display: flex; flex-shrink: 0; flex-wrap: wrap; gap: 8px 16px; padding: 8px 0 3px; }
.debug-response-stats > span { display: flex; align-items: baseline; gap: 5px; }
.debug-response-stats small { color: #999; font-size: 9px; }
.debug-response-stats strong { color: #555; font-size: 10px; font-weight: 500; font-variant-numeric: tabular-nums; }
@media (max-width: 340px) { .draft-indicator { display: none; } .debug-pane-heading { gap: 5px; } }
</style>
<style>
.panel-main:has(.request-detail-view) { overflow: hidden; padding-bottom: 0; }
.panel-main:has(.request-detail-view) > .page-frame { height: 100%; min-height: 0; }
.panel-main:has(.request-detail-view) .account-view { height: 100%; min-height: 0; display: flex; flex-direction: column; padding-top: 18px; }
.platform-panel.is-detail-view { display: flex; flex-direction: column; flex: 1; min-height: 0; }
@media (max-width: 340px) { .panel-main:has(.request-detail-view) { padding-inline: 18px; } }
</style>
