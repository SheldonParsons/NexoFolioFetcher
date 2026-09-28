<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
const props = defineProps<{ faviconUrl?: string; platform: string; project: string; environment?: string; active: boolean }>()
const failedIcon = ref(false)
const favicon = computed(() => {
  const value = props.faviconUrl || ''
  return /^(https?:\/\/|data:image\/)/i.test(value) ? value : ''
})
watch(() => props.faviconUrl, () => { failedIcon.value = false })
</script>
<template>
  <div class="binding-card" :class="{ 'is-active': active }" :title="active ? '当前窗口正在监听' : '当前窗口暂停监听'">
    <div class="binding-source">
      <span class="binding-source-icon"><img v-if="favicon && !failedIcon" :key="favicon" :src="favicon" alt="" width="16" height="16" referrerpolicy="no-referrer" @error="failedIcon = true" /><AppIcon v-else name="globe" :size="14" /></span>
      <h1 id="account-title" tabindex="-1" :title="platform">{{ platform }}</h1>
      <i class="binding-activity" aria-hidden="true"></i>
    </div>
    <div class="binding-destination">
      <span class="binding-connector" aria-hidden="true"><img src="/nexofolio-icon.svg" alt="" width="18" height="17" /></span>
      <div class="binding-project"><span>绑定项目</span><strong :title="project">{{ project }}</strong></div>
      <span class="binding-env" :class="{ empty: !environment }" :title="environment ? `当前环境：${environment}` : '尚未选择环境'"><i aria-hidden="true"></i>{{ environment || '待选环境' }}</span>
    </div>
  </div>
</template>
<style scoped>
.binding-card { flex-shrink: 0; padding: 13px 14px; border: 1px solid #e9e9e9; border-radius: 12px; background: #f6f6f6; transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease; }
.binding-card.is-active { background: linear-gradient(135deg, #fff 40%, #fafafa); border-color: #dedede; box-shadow: 0 2px 8px #00000003; }
.binding-source { display: flex; align-items: center; gap: 9px; min-width: 0; }
.binding-source-icon { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 16px; height: 16px; color: #999; }
.binding-source-icon img { display: block; width: 16px; height: 16px; object-fit: contain; }
.binding-source h1 { flex: 1; min-width: 0; margin: 0; font-size: 11px; line-height: 1.6; letter-spacing: 0; font-weight: 500; color: #737373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.binding-activity { flex-shrink: 0; width: 5px; height: 5px; border-radius: 50%; background: #c5c5c5; transition: background 240ms; }
.is-active .binding-activity { background: #45a46f; box-shadow: 0 0 0 3px #45a46f12; animation: binding-listening 1600ms ease-in-out infinite; }
@keyframes binding-listening { 0%, 100% { opacity: 1; box-shadow: 0 0 0 3px #45a46f12; } 50% { opacity: .4; box-shadow: 0 0 0 5px #45a46f04; } }
.binding-destination { display: flex; align-items: center; gap: 10px; margin-top: 12px; min-width: 0; }
.binding-connector { display: flex; flex-shrink: 0; align-items: center; justify-content: center; width: 18px; }
.binding-connector img { display: block; width: 18px; height: auto; object-fit: contain; }
.binding-project { flex: 1; min-width: 0; display: grid; gap: 3px; }
.binding-project > span { color: #999; font-size: 9px; }
.binding-project strong { font-size: 12px; line-height: 1.5; color: #333; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.binding-env { flex-shrink: 1; max-width: 40%; display: block; padding: 5px 7px; border: 1px solid #e4e4e4; border-radius: 6px; font-size: 10px; line-height: 1.3; color: #666; background: #ffffff9c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.binding-env i { display: inline-block; width: 4px; height: 4px; margin-right: 5px; vertical-align: 2px; border-radius: 50%; background: #888; }
.binding-env.empty { color: #aaa; border-style: dashed; }
.binding-env.empty i { background: #bbb; }
@media (prefers-reduced-motion: reduce) { .binding-card, .binding-activity { transition: none; } .is-active .binding-activity { animation: none; } }
</style>
