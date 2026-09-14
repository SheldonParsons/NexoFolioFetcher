<script setup lang="ts">
import { inject } from 'vue'
import { AvatarFallback, AvatarImage, AvatarRoot, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger } from 'reka-ui'
import type { AuthState } from '../../auth/contracts'
import AppIcon from './AppIcon.vue'
import { platformMenuKey } from '../../platforms/menu'

defineProps<{ state: AuthState; busy: boolean }>()
defineEmits<{ configure: []; logout: [] }>()
const platformMenu = inject(platformMenuKey, null)
</script>

<template>
  <footer class="account-footer" aria-label="账号与服务">
    <DropdownMenuRoot :modal="false">
      <DropdownMenuTrigger as-child>
        <button class="avatar-menu-trigger" type="button" :disabled="busy" aria-label="打开账号菜单" title="账号菜单">
          <AvatarRoot class="user-avatar">
            <AvatarImage v-if="state.user?.avatarUrl" :key="state.user.avatarUrl" :src="state.user.avatarUrl" alt="" referrerpolicy="no-referrer" />
            <AvatarFallback>{{ state.user?.displayName.slice(0, 1).toUpperCase() || 'A' }}</AvatarFallback>
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
            <DropdownMenuLabel class="account-menu-group-label">平台绑定</DropdownMenuLabel>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditName" @select="platformMenu.editName()"><AppIcon name="settings" :size="16" />修改平台名称</DropdownMenuItem>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditProjects" @select="platformMenu.editProjects()"><AppIcon name="settings" :size="16" />调整 / 添加项目</DropdownMenuItem>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canEditScope" @select="platformMenu.editScope()"><AppIcon name="globe" :size="16" />为当前路径单独绑定</DropdownMenuItem>
            <DropdownMenuItem class="account-menu-item" :disabled="busy || platformMenu.busy || !platformMenu.canUnbind" @select="platformMenu.unbind()"><AppIcon name="logout" :size="16" />解除当前项目绑定</DropdownMenuItem>
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
