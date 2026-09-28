import type { InjectionKey, ShallowRef } from 'vue'

export interface PlatformMenu {
  owner: symbol
  busy: boolean
  canEditProject: boolean
  canEditScope: boolean
  canEditEnvironment: boolean
  editProject: () => void
  editScope: () => void
  editEnvironment: () => void
}

// UI-only commands for the active platform panel; each browser panel owns its provider.
export const platformMenuKey: InjectionKey<ShallowRef<PlatformMenu | null>> = Symbol('platform-menu')
