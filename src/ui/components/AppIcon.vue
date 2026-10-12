<script setup lang="ts">
import { MorphIcon } from 'morphicons/vue'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Copy, Plus, Eye, EyeOff, Globe, LockKeyhole, Settings2, LogOut } from 'lucide'

const icons = { arrowLeft: ArrowLeft, arrowRight: ArrowRight, check: Check, chevronRight: ChevronRight,
  copy: Copy, plus: Plus, eye: Eye, eyeOff: EyeOff, globe: Globe, lock: LockKeyhole, settings: Settings2, logout: LogOut }
withDefaults(defineProps<{ name: keyof typeof icons; size?: number }>(), { size: 18 })
</script>

<template>
  <MorphIcon :icon="icons[name]" :size="size" :stroke-width="1.6" reduced-motion="user" aria-hidden="true" />
</template>
