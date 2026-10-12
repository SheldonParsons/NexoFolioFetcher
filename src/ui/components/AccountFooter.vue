<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { AvatarFallback, AvatarImage, AvatarRoot, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import type { AuthState } from '../../auth/contracts'
import AppIcon from './AppIcon.vue'
import { platformMenuKey } from '../../platforms/menu'

const props = defineProps<{ state: AuthState; busy: boolean }>()
defineEmits<{ configure: []; logout: [] }>()
const platformMenu = inject(platformMenuKey, null)
const avatarRevision = ref(0)
const initial = computed(() => [...(props.state.user?.displayName.trim() || props.state.user?.username || 'A')][0]?.toUpperCase())
// Remount the image loader on identity/source changes, including removal after a loaded image.
watch([() => props.state.service?.url, () => props.state.sessionId, () => props.state.user?.id, () => props.state.user?.avatarUrl],
  () => { avatarRevision.value++ }, { flush: 'sync' })
</script>

<template>
  <footer class="account-footer" aria-label="账号与服务">
    <DropdownMenuRoot :modal="false">
      <DropdownMenuTrigger as-child>
        <button class="avatar-menu-trigger" type="button" :disabled="busy" aria-label="打开账号菜单" title="账号菜单">
          <AvatarRoot :key="avatarRevision" class="user-avatar" aria-hidden="true">
            <AvatarImage v-if="state.user?.avatarUrl" :src="state.user.avatarUrl" alt="" referrer-policy="no-referrer" />
            <AvatarFallback>{{ initial }}</AvatarFallback>
          </AvatarRoot>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuPortal>
        <DropdownMenuContent class="account-menu" side="top" align="start" :side-offset="12" :collision-padding="16">
          <DropdownMenuLabel class="account-menu-heading">
            <strong>{{ state.service?.name || 'NexoFolio 服务' }}</strong>
            <span>{{ state.service?.url }}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator class="account-menu-separator" />
          <DropdownMenuItem class="account-menu-item" :disabled="busy" @select="$emit('configure')"><AppIcon name="settings" :size="16" />服务配置<AppIcon class="account-menu-chevron" name="chevronRight" :size="14" /></DropdownMenuItem>
          <template v-if="platformMenu">
            <DropdownMenuSeparator class="account-menu-separator" />
            <DropdownMenuLabel class="account-menu-group-label">站点绑定</DropdownMenuLabel>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditProject" @select="platformMenu.editProject()"><AppIcon name="settings" :size="16" />更换绑定项目</DropdownMenuItem>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditEnvironment" @select="platformMenu.editEnvironment()"><AppIcon name="settings" :size="16" />更换环境</DropdownMenuItem>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditScope" @select="platformMenu.editScope()"><AppIcon name="globe" :size="16" />新建站点 / 路径绑定</DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
    <div class="footer-identity">
      <strong :title="state.user?.displayName">{{ state.user?.displayName }}</strong>
      <span :title="state.user?.username">@{{ state.user?.username }}</span>
    </div>
    <button class="footer-logout" type="button" :disabled="busy" aria-label="退出登录" title="退出登录" @click="$emit('logout')"><AppIcon name="logout" :size="17" /></button>
  </footer>
</template>
