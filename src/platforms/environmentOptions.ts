import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { Environment, EnvironmentPage } from '../api/nexofolio/environments'

// Only query an explicitly selected project. Synchronous invalidation prevents an
// old project's async result from repopulating the next project's environment list.
export function useEnvironmentOptions(
  projectId: Ref<string | undefined>,
  environmentId: Ref<string | undefined>,
  environmentName: Ref<string>,
  fetchPage: (projectId: string, page: number) => Promise<EnvironmentPage>,
) {
  const options = ref<Environment[]>([]), page = ref(0), total = ref(0), loading = ref(false), error = ref('')
  let revision = 0, disposed = false
  function reset() {
    ++revision; options.value = []; page.value = total.value = 0; loading.value = false; error.value = ''
  }
  async function load(more = false) {
    const id = projectId.value, request = ++revision
    if (!id) return
    loading.value = true; error.value = ''
    try {
      const result = await fetchPage(id, more ? page.value + 1 : 1)
      if (disposed || request !== revision || id !== projectId.value) return
      options.value = more ? [...options.value, ...result.items.filter(item => !options.value.some(old => old.id === item.id))] : result.items
      page.value = result.page; total.value = result.total
      const selected = result.items.find(item => item.id === environmentId.value)
      if (selected) environmentName.value = selected.name
    } catch {
      if (!disposed && request === revision) error.value = '环境列表暂不可用，可重试或手填环境名称。'
    } finally { if (!disposed && request === revision) loading.value = false }
  }
  watch(projectId, () => { reset(); void load() }, { flush: 'sync', immediate: true })
  onScopeDispose(() => { disposed = true; ++revision })
  return { options, page, total, loading, error, load, reset }
}
