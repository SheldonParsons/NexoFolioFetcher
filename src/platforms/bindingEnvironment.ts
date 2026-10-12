import { computed, ref, watch, type Ref } from 'vue'
import type { Environment, EnvironmentPage } from '../api/nexofolio/environments'
import { platformCommand } from './bridge'
import { useEnvironmentOptions } from './environmentOptions'

// A draft only: creating an environment remains part of the final background bind.
export function useBindingEnvironment(projectId: Ref<string | undefined>) {
  const name = ref(''), id = ref<string>(), creating = ref(false)
  const error = ref(''), revision = ref(0)
  function reset(value?: Environment) {
    name.value = value?.name ?? ''; id.value = value?.id
    creating.value = false; error.value = ''
  }
  watch(projectId, () => reset(), { flush: 'sync' })
  const list = useEnvironmentOptions(projectId, id, name,
    (project, page) => platformCommand<EnvironmentPage>({ type: 'platform.environments', projectId: project, page }))
  const duplicate = computed(() => creating.value ? list.options.value.find(option => option.name === name.value.trim()) : undefined)
  const validName = computed(() => !!name.value.trim() && [...name.value.trim()].length <= 64 && !/[\u0000-\u001f\u007f]/.test(name.value))
  const ready = computed(() => !!projectId.value && (creating.value ? validName.value && !duplicate.value : !!id.value))
  function create() {
    if (!projectId.value || list.loading.value || list.error.value) return
    reset(); creating.value = true
  }
  function rename(value: string) { name.value = value; error.value = '' }
  function validate() {
    revision.value++
    error.value = creating.value
      ? !validName.value ? '环境名称需为 1–64 个字符，可使用中文，不含控制字符。'
        : duplicate.value ? '该名称已存在，请选择现有环境。' : ''
      : !id.value ? '请选择当前网页实际所在的环境。' : ''
    return !error.value && ready.value
  }
  return { name, id, creating, error, revision, duplicate, ready, list, reset, create, rename, validate }
}
