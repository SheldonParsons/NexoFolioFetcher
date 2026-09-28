<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Label, ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui'
import type { ProjectCard, ProjectPage } from '../../api/nexofolio/projects'
import { platformCommand } from '../../platforms/bridge'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ select: [project: ProjectCard | null] }>()
const projects = ref<ProjectCard[]>([]), selected = ref(''), search = ref('')
const loading = ref(false), error = ref(''), selectionError = ref(''), count = ref(0)
const filtered = computed(() => projects.value.filter(project => project.name.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))
let page = 0, revision = 0, disposed = false
async function load(more = false) {
  const request = ++revision
  loading.value = true; error.value = ''
  try {
    const result = await platformCommand<ProjectPage>({ type: 'platform.projects', search: '', page: more ? page + 1 : 1 })
    if (disposed || request !== revision) return
    projects.value = more ? [...projects.value, ...result.projects.filter(row => !projects.value.some(old => old.id === row.id))] : result.projects
    page = result.page; count.value = result.count
    selected.value = ''; emit('select', null)
  } catch (cause) { if (!disposed && request === revision) error.value = cause instanceof Error ? cause.message : '无法读取项目。' }
  finally { if (request === revision) loading.value = false }
}
function choose(value: unknown) {
  const project = projects.value.find(project => project.id === value)
  selectionError.value = ''
  if (!project?.canAccess) {
    selected.value = ''; emit('select', null)
    selectionError.value = project?.accessState === 'unknown' ? '暂时无法确认该项目权限，不能绑定，请稍后重试。' : '你没有权限进入或绑定这个项目。'
    return
  }
  selected.value = project.id; emit('select', project)
}
onMounted(() => void load())
onBeforeUnmount(() => { disposed = true; ++revision })
</script>
<template>
  <div class="project-picker">
    <Label for="project-search">NexoFolio 项目</Label>
    <input id="project-search" v-model="search" class="project-search" :disabled="disabled" placeholder="筛选已加载项目" autocomplete="off" />
    <ListboxRoot v-if="filtered.length" :model-value="selected" :disabled="disabled || loading" selection-behavior="replace" @update:model-value="choose">
      <ListboxContent class="project-list" aria-label="选择 NexoFolio 项目" :aria-busy="loading">
        <ListboxItem v-for="project in filtered" :key="project.id" class="project-option" :value="project.id" :class="{ 'project-inaccessible': !project.canAccess }">
          <span class="project-option-name">{{ project.name }}<small class="project-access-label">{{ project.status }}{{ project.canAccess ? '' : project.accessState === 'unknown' ? ' · 权限待确认' : ' · 无访问权限' }}</small></span>
        </ListboxItem>
      </ListboxContent>
    </ListboxRoot>
    <div v-else class="project-list-state" role="status">{{ loading ? '正在读取项目…' : error ? '项目读取失败' : projects.length ? '已加载项目中没有匹配项' : '暂无已同步项目' }}</div>
    <p v-if="selectionError" class="platform-error" role="alert">{{ selectionError }}</p>
    <p v-if="error" class="platform-error" role="alert">{{ error }} <button type="button" class="inline-button" :disabled="disabled || loading" @click="load()">重新读取</button></p>
    <button v-if="projects.length < count" type="button" class="inline-button" :disabled="disabled || loading" @click="load(true)">加载更多（{{ projects.length }}/{{ count }}）</button>
  </div>
</template>
<style scoped>
.project-access-label { display: block; margin-top: 3px; color: #888; font-size: 10px; }
.project-inaccessible { color: #888; }
</style>
