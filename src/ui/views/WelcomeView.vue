<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ServiceConfig } from '../../settings/service'
import AppIcon from '../components/AppIcon.vue'
import ServiceSummary from '../components/ServiceSummary.vue'
import FetcherMark from '../components/FetcherMark.vue'

defineProps<{ service: ServiceConfig | null; loading: boolean }>()
defineEmits<{ login: []; configure: [] }>()
const logoHovered = ref(false)
const logoFocused = ref(false)
const logoActive = computed(() => logoHovered.value || logoFocused.value)
</script>

<template>
  <section class="welcome-view" aria-labelledby="welcome-title">
    <div class="welcome-art">
      <div class="art-grid" aria-hidden="true"></div>
      <div class="logo-tile" tabindex="0" role="img" aria-label="NexoFolio Fetcher"
        @pointerenter="$event.pointerType !== 'touch' && (logoHovered = true)" @pointerleave="logoHovered = false" @pointercancel="logoHovered = false"
        @focus="logoFocused = ($event.target as HTMLElement).matches(':focus-visible')" @blur="logoFocused = false">
        <FetcherMark class="welcome-mark" :active="logoActive" glow />
      </div>
      <span class="art-caption" aria-hidden="true">FETCHER</span>
    </div>
    <div class="welcome-copy">
      <h1 id="welcome-title" tabindex="-1">捕获此刻。<br /><span>留住有用的细节。</span></h1>
    </div>
    <div class="welcome-actions">
      <button class="button primary" type="button" :disabled="loading" @click="$emit('login')">
        {{ loading ? '正在读取配置…' : '登录 NexoFolio' }}<AppIcon name="arrowRight" />
      </button>
      <ServiceSummary :service="service" @configure="$emit('configure')" />
    </div>
  </section>
</template>
