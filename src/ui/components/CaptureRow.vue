<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CapturedRequest } from '../../capture/contracts'

const props = defineProps<{ request: CapturedRequest }>()
const confirmedFlash = ref(false)
let flashTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.request.upload?.state, (next, previous) => {
  clearTimeout(flashTimer)
  confirmedFlash.value = next === 'confirmed' && !!previous && previous !== 'confirmed'
  if (confirmedFlash.value) flashTimer = setTimeout(() => { confirmedFlash.value = false }, 900)
})
onBeforeUnmount(() => clearTimeout(flashTimer))
const uploadState = computed(() => props.request.upload?.state || 'collecting')
const path = computed(() => {
  try { return new URL(props.request.url).pathname || '/' }
  catch { return props.request.url.replace(/^https?:\/\/[^/]+/i, '').split(/[?#]/)[0] || '/' }
})
const status = computed(() => {
  const response = props.request.response
  if (response.status !== null && response.status > 0) {
    const tone = response.status >= 500 ? 'danger' : response.status >= 400 ? 'warning' : response.status >= 300 ? 'redirect' : response.status >= 200 ? 'success' : 'neutral'
    return { tone, key: String(response.status), label: String(response.status), title: `HTTP ${response.status}`, pending: false }
  }
  const pending = response.state === 'pending' || response.state === 'reading'
  const label = pending ? '等待' : response.state === 'timeout' ? '超时' : response.state === 'failed' ? '失败' : '—'
  return { key: label, label, title: pending ? '等待响应' : response.message || '未取得响应码', pending, tone: pending ? 'neutral' : 'danger' }
})
</script>

<template>
  <div class="request-line" :class="[`upload-${uploadState}`, { 'upload-confirming': confirmedFlash }]" :title="request.upload?.message">
    <span class="request-upload-fill" aria-hidden="true"><span class="request-upload-cells"></span></span>
    <span class="request-method" :title="request.method">{{ request.method }}</span>
    <code class="request-path" :title="path">{{ path }}</code>
    <span class="request-status-slot" :aria-label="status.title" :title="status.title">
      <Transition name="request-status" mode="out-in">
        <span :key="status.key" class="request-status" :class="[{ 'is-pending': status.pending }, `tone-${status.tone}`]" aria-hidden="true">
          <span v-if="status.pending" class="request-wait"><i></i><i></i><i></i></span>
          <template v-else>{{ status.label }}</template>
        </span>
      </Transition>
    </span>
  </div>
</template>

<style scoped>
.request-line { position: relative; isolation: isolate; overflow: hidden; display: grid; grid-template-columns: 49px minmax(0, 1fr) 36px; align-items: center; gap: 10px; min-height: 43px; padding: 0 10px; border-radius: 8px; background: #fff; transition: background-color 140ms ease; }
.request-line > :not(.request-upload-fill) { position: relative; z-index: 1; }
.request-upload-fill { position: absolute; inset: 2px 0; z-index: 0; border-radius: 7px; overflow: hidden; pointer-events: none; opacity: 0; background: #0000000a; }
.upload-collecting .request-upload-fill, .upload-queued .request-upload-fill, .upload-sending .request-upload-fill { opacity: 1; }
.request-upload-cells { position: absolute; inset: 0 auto 0 0; width: 78%; background-image: repeating-conic-gradient(#00000038 0% 25%, transparent 0% 50%); background-size: 10px 10px; mask-image: linear-gradient(90deg, transparent, #000 16%, #000 78%, transparent); animation: upload-flow 1800ms linear infinite; }
.upload-collecting .request-upload-cells { opacity: .65; animation-duration: 2400ms; }
.upload-sending .request-upload-fill { background: #00000014; }
.upload-sending .request-upload-cells { width: 90%; background-image: repeating-conic-gradient(#00000048 0% 25%, transparent 0% 50%); animation-duration: 1100ms; }
.upload-confirmed .request-upload-cells, .upload-failed .request-upload-cells { animation: none; display: none; }
.upload-confirming .request-upload-fill { background: #00000024; animation: upload-confirm 900ms ease-out both; transform-origin: left; }
.upload-failed .request-upload-fill { opacity: 1; background: repeating-linear-gradient(135deg, #00000004 0 3px, transparent 3px 8px); border-left: 2px solid #999; }
@keyframes upload-flow { from { transform: translateX(-65%); } to { transform: translateX(135%); } }
@keyframes upload-confirm { 0% { opacity: 1; transform: scaleX(.65); } 30%, 55% { opacity: 1; transform: scaleX(1); } 100% { opacity: 0; transform: scaleX(1); } }
.request-line:hover { background: #f6f6f6; }
.request-method { display: block; padding: 4px 3px; border-radius: 4px; background: #f1f1f1; color: #4a4a4a; font: 600 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.request-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color: #333; user-select: text; }
.request-status-slot { display: grid; place-items: center; height: 24px; overflow: hidden; }
.request-status { display: grid; place-items: center; min-width: 32px; height: 21px; padding: 0 3px; border: 1px solid #e8e8e8; border-radius: 5px; color: #555; font: 500 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
.request-status.tone-success { color: #557460; background: #f3f7f4; border-color: #e0e9e2; }
.request-status.tone-redirect { color: #617387; background: #f3f5f8; border-color: #e0e6ed; }
.request-status.tone-warning { color: #946831; background: #fbf6ed; border-color: #ebddc5; }
.request-status.tone-danger { color: #a15353; background: #fbf1f1; border-color: #edd6d6; }
.request-status.is-pending { border-color: transparent; }
.request-wait { display: flex; align-items: center; gap: 3px; }
.request-wait i { width: 3px; height: 3px; border-radius: 50%; background: #888; animation: request-wait 1000ms ease-in-out infinite; }
.request-wait i:nth-child(2) { animation-delay: 120ms; }
.request-wait i:nth-child(3) { animation-delay: 240ms; }
.request-status-enter-active { transition: opacity 120ms ease-out, transform 120ms ease-out; }
.request-status-leave-active { transition: opacity 70ms ease-in, transform 70ms ease-in; }
.request-status-enter-from { opacity: 0; transform: translateY(5px); }
.request-status-leave-to { opacity: 0; transform: translateY(-4px); }
@keyframes request-wait { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
@media (max-width: 340px) { .request-line { grid-template-columns: 44px minmax(0, 1fr) 34px; gap: 7px; padding-inline: 7px; } }
@media (prefers-reduced-motion: reduce) {
  .request-line, .request-status-enter-active, .request-status-leave-active { transition: none; }
  .request-wait i { animation: none; opacity: .65; }
  .request-upload-cells { animation: none; width: 100%; transform: none; opacity: .35; }
  .upload-confirming .request-upload-fill { animation: none; opacity: 0; }
}
</style>
