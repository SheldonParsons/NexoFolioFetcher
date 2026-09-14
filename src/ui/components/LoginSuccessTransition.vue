<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import FetcherMark from './FetcherMark.vue'
import { arrivalPose, DURATION } from '../motion/fetcherMotion'
import { useReducedMotion } from '../motion/useReducedMotion'
const props = defineProps<{ runId: number }>()
const emit = defineEmits<{ complete: [runId: number] }>()
const root = ref<HTMLElement>()
const elapsed = ref(0)
const reduced = useReducedMotion()
const opacity = computed(() => arrivalPose(elapsed.value, reduced.value).opacity)
let started = 0, raf = 0, timer: ReturnType<typeof setTimeout> | undefined, finished = false
function clean() { cancelAnimationFrame(raf); clearTimeout(timer); document.removeEventListener('visibilitychange', resume) }
function finish() { if (finished) return; finished = true; elapsed.value = DURATION; clean(); emit('complete', props.runId) }
function tick() {
  if (finished) return
  elapsed.value = Math.min(DURATION, performance.now() - started)
  if (elapsed.value >= DURATION) { finish(); return }
  raf = requestAnimationFrame(tick)
}
function resume() { if (!document.hidden && performance.now() - started >= DURATION) finish() }
onMounted(() => {
  started = performance.now()
  root.value?.focus({ preventScroll: true })
  timer = setTimeout(finish, DURATION)
  raf = requestAnimationFrame(tick)
  document.addEventListener('visibilitychange', resume)
})
onBeforeUnmount(() => { finished = true; clean() })
</script>
<template>
  <div ref="root" class="login-success-overlay" :style="{ opacity }" :data-run="runId" tabindex="-1" role="status" aria-label="登录成功，正在进入 NexoFolio">
    <FetcherMark class="login-success-logo" arrival :elapsed="elapsed" />
  </div>
</template>
<style scoped>
.login-success-overlay { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #fff; outline: none; }
.login-success-logo { --mark-size: min(43.333333vw, 153.333333px); }
</style>
