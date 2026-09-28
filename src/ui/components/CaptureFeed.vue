<script setup lang="ts">
import { computed } from 'vue'
import { CAPTURE_LIMIT, type CaptureSnapshot } from '../../capture/contracts'
import AppIcon from './AppIcon.vue'
import CaptureRow from './CaptureRow.vue'
import { rejectionReason } from '../../upload/contracts'

const props = defineProps<{ snapshot: CaptureSnapshot }>()
const emit = defineEmits<{ retry: [] }>()
const attention = computed(() => ['error','interrupted'].includes(props.snapshot.status) || !!props.snapshot.upload?.failed || !!props.snapshot.upload?.paused)
const attentionMessage = computed(() => [props.snapshot.message, props.snapshot.upload?.message, ...(props.snapshot.upload?.failures || []).map(f => `${f.count} 条被拒绝：${rejectionReason(f.reason)}，原始记录保留`)].filter(Boolean).join('\n'))
</script>

<template>
  <section class="capture-feed" aria-label="最近捕获的接口">
    <div class="capture-heading">
      <span class="capture-heading-label"><i class="capture-indicator" :class="{ live: snapshot.status === 'listening' }" :title="snapshot.message" aria-hidden="true"></i>接口</span>
      <span v-if="attention" class="capture-attention" tabindex="0" role="img" :aria-label="attentionMessage" :title="attentionMessage">!</span>
      <span class="capture-count">{{ snapshot.rows.length }} / {{ CAPTURE_LIMIT }}</span>
    </div>
    <p v-if="snapshot.status === 'error' || snapshot.status === 'interrupted'" class="capture-error" role="alert">{{ snapshot.message || '监听未能启动，请重试。' }}</p>
    <button v-if="snapshot.status === 'error' || snapshot.status === 'interrupted'" class="inline-button" type="button" @click="emit('retry')">重试监听<AppIcon name="arrowRight" :size="14" /></button>
    <p v-if="!snapshot.rows.length && snapshot.status === 'listening'" class="capture-empty">等待当前页面发出请求…</p>
    <TransitionGroup tag="ol" name="request-list" class="capture-list" tabindex="0" aria-label="已捕获接口，可滚动">
      <li v-for="row in snapshot.rows" :key="row.id" class="capture-row"><CaptureRow :request="row" /></li>
    </TransitionGroup>
  </section>
</template>

<style scoped>
.capture-error { margin: 10px 0 0; color: #946831; font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.capture-attention { display: grid; place-items: center; width: 14px; height: 14px; margin-left: auto; border: 1px solid #aaa; border-radius: 50%; color: #666; font-size: 9px; cursor: help; }
.capture-attention:focus-visible { outline: 1px solid #777; outline-offset: 3px; }
.capture-heading-label { display: flex; align-items: center; gap: 7px; }
.capture-indicator { width: 5px; height: 5px; border-radius: 50%; background: #bbb; }
.capture-indicator.live { background: #444; }
.capture-feed { display: flex; flex-direction: column; min-height: 0; }
.capture-feed > :not(.capture-list) { flex-shrink: 0; }
.capture-list { flex: 1; min-height: 0; max-height: 55dvh; overflow-y: auto; overflow-x: hidden; overscroll-behavior-y: contain; scrollbar-width: none; -ms-overflow-style: none; list-style: none; padding: 2px 0; margin: 14px -10px 0; }
.capture-list::-webkit-scrollbar { display: none; width: 0; height: 0; }
.capture-list:focus-visible { outline: 1px solid #bbb; outline-offset: 2px; border-radius: 8px; }
.capture-row { padding: 0; margin: 0; border: 0; }
.capture-row + .capture-row { border-top: 1px solid #f0f0f0; }
/* Short entry and FLIP movement keep the newest row easy to locate without staggering the feed. */
.request-list-enter-active { transition: opacity 180ms ease-out, transform 180ms cubic-bezier(.22, 1, .36, 1); }
.request-list-enter-from { opacity: 0; transform: translateY(-7px); }
.request-list-move { transition: transform 180ms cubic-bezier(.22, 1, .36, 1); }
.request-list-leave-active { display: none; }
@media (max-width: 340px) { .capture-list { margin-inline: -7px; } }
@media (prefers-reduced-motion: reduce) { .request-list-enter-active, .request-list-move { transition: none; } }
</style>
