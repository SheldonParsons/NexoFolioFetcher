<script setup lang="ts">
import type { AuthState } from '../../auth/contracts'
import AppIcon from '../components/AppIcon.vue'
import PlatformPanel from './PlatformPanel.vue'

defineProps<{ state: AuthState; busy: boolean; error: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="account-view" aria-labelledby="account-title">
    <div v-if="state.status === 'unverified'" class="account-notice">
      <h1 id="account-title" tabindex="-1">登录待验证</h1>
      <p>{{ state.message }}</p>
      <button class="inline-button" :disabled="busy" @click="$emit('retry')">重新验证<AppIcon name="arrowRight" :size="14" /></button>
    </div>
    <p v-if="state.projectSync?.status === 'failed'" class="platform-error" role="status">登录成功，但项目同步失败；当前显示上次成功同步的项目权限。</p>
    <p v-else-if="state.projectSync?.status === 'skipped'" class="platform-hint" role="status">本次登录未同步项目，使用已有项目权限。</p>
    <PlatformPanel v-if="state.status !== 'unverified'" :key="state.user?.id" />
    <p v-if="error" class="field-error" role="alert">{{ error }}</p>
  </section>
</template>
