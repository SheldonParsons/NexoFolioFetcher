<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Label, ListboxContent, ListboxItem, ListboxItemIndicator, ListboxRoot } from 'reka-ui'
import type { JoinedProject, ProjectPage } from '../../api/asynctest/projects'
import { platformCommand } from '../../platforms/bridge'
import AppIcon from './AppIcon.vue'

defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ select: [project: JoinedProject | null] }>()
const projects = ref<JoinedProject[]>([])
const selected = ref('')
const search = ref('')
const loading = ref(false)
const error = ref('')
const count = ref(0)
let page = 0
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false

async function load(more = false) {
  const request = ++revision
  loading.value = true
  error.value = ''
  try {
    const result = await platformCommand<ProjectPage>({ type: 'platform.projects', search: search.value, page: more ? page + 1 : 1 })
    if (disposed || request !== revision) return
    projects.value = more ? [...projects.value, ...result.projects.filter(row => !projects.value.some(old => old.id === row.id))] : result.projects
    page = result.page
    count.value = result.count
  } catch (cause) { if (!disposed && request === revision) error.value = cause instanceof Error ? cause.message : '无法读取项目。' }
  finally { if (request === revision) loading.value = false }
}
function searchChanged() {
  ++revision
  selected.value = ''
  projects.value = []
  count.value = 0
  loading.value = true
  emit('select', null)
  clearTimeout(timer)
  timer = setTimeout(() => void load(), 250)
}
function choose(value: unknown) {
  selected.value = String(value ?? '')
  emit('select', projects.value.find(project => String(project.id) === selected.value) ?? null)
}
onMounted(() => void load())
onBeforeUnmount(() => { disposed = true; ++revision; clearTimeout(timer) })
</script>

<template>
  <div class="project-picker">
    <Label for="project-search">已加入的项目</Label>
    <input id="project-search" v-model="search" class="project-search" :disabled="disabled" placeholder="搜索项目" autocomplete="off" @input="searchChanged" />
    <ListboxRoot v-if="projects.length" :model-value="selected" :disabled="disabled || loading" selection-behavior="replace" @update:model-value="choose">
      <ListboxContent class="project-list" aria-label="选择 NexoFolio 项目" :aria-busy="loading">
        <ListboxItem v-for="project in projects" :key="project.id" class="project-option" :value="String(project.id)">
          <span class="project-option-name">{{ project.name }}</span>
          <ListboxItemIndicator class="project-selected-mark"><AppIcon name="check" :size="14" /></ListboxItemIndicator>
        </ListboxItem>
      </ListboxContent>
    </ListboxRoot>
    <div v-else class="project-list-state" role="status">{{ loading ? '正在读取项目…' : error ? '项目读取失败' : '没有找到已加入的项目' }}</div>
    <p v-if="error" class="platform-error" role="alert">{{ error }} <button type="button" class="inline-button" :disabled="disabled || loading" @click="load()">重新读取</button></p>
    <button v-if="projects.length < count" type="button" class="inline-button" :disabled="disabled || loading" @click="load(true)">加载更多（{{ projects.length }}/{{ count }}）</button>
  </div>
</template>
