import type { InjectionKey, ShallowRef } from 'vue'

export interface PlatformMenu {
  owner: symbol
  busy: boolean
  canEditProjects: boolean
  canEditScope: boolean
  canEditName: boolean
  canEditEnvironment: boolean
  editEnvironment: () => void
  canUnbind: boolean
  editProjects: () => void
  editScope: () => void
  editName: () => void
  unbind: () => void
}

// UI-only commands for the active platform panel; each browser panel owns its provider.
export const platformMenuKey: InjectionKey<ShallowRef<PlatformMenu | null>> = Symbol('platform-menu')
