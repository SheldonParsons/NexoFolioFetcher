<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { arrivalPose, colors, hoverPose, SETTLE, smooth } from '../motion/fetcherMotion'
import { iconPaths, wordmarkPaths } from '../motion/nexofolioGeometry'
import { useReducedMotion } from '../motion/useReducedMotion'

const props = withDefaults(defineProps<{ active?: boolean; elapsed?: number; arrival?: boolean; glow?: boolean; iconOnly?: boolean }>(), { active: false, elapsed: 0, arrival: false, glow: false, iconOnly: false })
const gradientId = `nexofolio-spectrum-${useId()}`
const reduced = useReducedMotion()
const level = ref(0), phase = ref(0)
let raf = 0, destroyed = false, from = 0, target = 0, epoch = 0, last = 0
const arrival = computed(() => arrivalPose(props.elapsed, reduced.value))
const amount = computed(() => props.arrival ? arrival.value.amount : level.value)
const pose = computed(() => props.arrival ? [arrival.value.left, arrival.value.right] : hoverPose(phase.value, level.value, reduced.value))
const stops = computed(() => colors(reduced.value ? 0 : props.arrival ? props.elapsed : phase.value))
function updateLevel(now: number) { level.value = from + (target - from) * smooth((now - epoch) / SETTLE) }
function schedule() { if (!raf && !destroyed && !props.arrival && !document.hidden) raf = requestAnimationFrame(frame) }
function frame(now: number) {
  raf = 0
  if (destroyed) return
  updateLevel(now)
  if (last && !reduced.value) phase.value += Math.min(now - last, 64)
  last = now
  if (Math.abs(level.value - target) > .00001 || (!reduced.value && target === 1)) schedule()
  else if (!target) { level.value = 0; last = 0 }
}
function change() {
  const now = performance.now()
  updateLevel(now); from = level.value; target = props.active ? 1 : 0; epoch = now; last = now
  schedule()
}
function visibility() {
  cancelAnimationFrame(raf); raf = 0; last = 0
  if (!document.hidden) schedule()
}
onMounted(() => { change(); document.addEventListener('visibilitychange', visibility) })
watch(() => props.active, change)
watch(reduced, () => { last = performance.now(); schedule() })
onBeforeUnmount(() => { destroyed = true; cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', visibility) })
</script>

<template>
  <span class="fetcher-mark" :class="{ 'icon-only': iconOnly }" aria-hidden="true">
    <span v-if="glow" class="fetcher-aura" :style="{ opacity: .24 * amount, transform: `rotate(${reduced ? 0 : phase / 5600 * 55}deg)` }"></span>
    <svg class="fetcher-svg" :viewBox="iconOnly ? '0 0 522 483' : '0 0 750 684'" fill="none" :style="{ transform: `scale(${props.arrival ? arrival.scale : 1})` }">
      <defs><linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1"><stop v-for="(color, i) in stops" :key="i" :offset="i / 4" :stop-color="color" /></linearGradient></defs>
      <g :transform="iconOnly ? undefined : 'translate(113 0)'">
        <path class="motion-piece" :d="iconPaths[0]" fill="#000000" fill-rule="evenodd" :style="{ transform: pose[0], opacity: props.arrival ? arrival.leftOpacity : 1 }" />
        <g class="motion-piece" :style="{ transform: pose[1], opacity: props.arrival ? arrival.rightOpacity : 1 }">
          <path :d="iconPaths[1]" fill="#000000" fill-rule="evenodd" />
          <path :d="iconPaths[1]" :fill="`url(#${gradientId})`" fill-rule="evenodd" :opacity="amount" />
        </g>
      </g>
      <g v-if="!iconOnly" :transform="`translate(0 ${props.arrival ? arrival.wordY : 530})`" :opacity="props.arrival ? arrival.wordOpacity : 1">
        <path v-for="(path, i) in wordmarkPaths" :key="i" :d="path" fill="#000000" fill-rule="evenodd" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
.fetcher-mark { position: relative; display: block; isolation: isolate; width: var(--mark-size, 168px); aspect-ratio: 750 / 684; }
.fetcher-mark.icon-only { aspect-ratio: 522 / 483; }
.fetcher-svg { position: relative; display: block; width: 100%; height: 100%; overflow: visible; }
.motion-piece { transform-box: fill-box; transform-origin: center; }
.fetcher-aura { position: absolute; width: 110%; height: 74%; top: -1%; left: -5%; border-radius: 50%; background: conic-gradient(from 215deg, #15ae73, #258de0, #6847ef, #c520d9, #f13865, #ff922e, #c9bd13, #15ae73); filter: blur(25px); opacity: 0; pointer-events: none; }
</style>
