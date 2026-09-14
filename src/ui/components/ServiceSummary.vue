<script setup lang="ts">
import type { ServiceConfig } from '../../settings/service'
import AppIcon from './AppIcon.vue'

defineProps<{ service: ServiceConfig | null }>()
defineEmits<{ configure: [] }>()
</script>

<template>
  <button class="service-summary" type="button" @click="$emit('configure')" aria-label="配置 NexoFolio 服务" :title="service?.url">
    <AppIcon name="globe" :size="13" />
    <span class="service-label">{{ service ? (service.name || service.url) : '配置 NexoFolio 服务' }}</span>
    <AppIcon name="chevronRight" :size="12" />
  </button>
</template>
