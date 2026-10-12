<script setup lang="ts">
import { computed } from 'vue'
import type { UpdateState } from '../../updates/manager'
const props = defineProps<{ state: UpdateState; error: string; canLogout: boolean; busy?: boolean }>()
defineEmits<{ check: []; download: []; logout: []; close: [] }>()
const title = computed(() => props.state.phase === 'required' ? '更新后，继续捕获。' : props.state.allowed ? '让 Fetcher 保持最新。' : '先确认版本，再继续。')
</script>
<template>
  <section class="update-view">
    <button v-if="state.allowed" class="back-button" @click="$emit('close')">返回</button>
    <img class="update-brand" src="/nexofolio-icon.svg" alt="NexoFolio" width="42" height="42" />
    <p class="update-eyebrow">FETCHER · UPDATE</p>
    <h1 tabindex="-1">{{ title }}</h1>
    <p class="update-copy" role="status">{{ state.message }}</p>
    <dl class="update-versions"><div><dt>当前版本</dt><dd>{{ state.current }}</dd></div><div><dt>最新版本</dt><dd>{{ state.latest?.version || '待确认' }}</dd></div></dl>
    <p v-if="!state.allowed" class="update-retained">采集与上传已暂停。登录、项目绑定和未上传内容均已保留。</p>
    <div v-if="state.latest?.releaseNotes?.length" class="update-notes"><h2>此次更新</h2><ul><li v-for="note in state.latest.releaseNotes" :key="note">{{ note }}</li></ul></div>
    <p v-if="error" role="alert" class="update-copy">{{ error }}</p>
    <div class="update-actions">
      <button class="update-primary" :disabled="!state.latest" @click="$emit('download')">下载最新版本</button>
      <button class="update-secondary" :disabled="state.checking" @click="$emit('check')">{{ state.checking ? '正在检查…' : '我已更新，重新检查' }}</button>
    </div>
    <p class="update-install">下载后解压，替换原安装目录中的文件，再到 Chrome 扩展管理页重新加载。下载 ZIP 不会自动安装。<span v-if="state.latest"> 新版需要 Chrome {{ state.latest.minimumChromeVersion }} 或更高版本。</span></p>
    <button v-if="canLogout" class="update-logout" :disabled="busy" @click="$emit('logout')">退出登录</button>
  </section>
</template>
<style scoped>
.update-view{padding:24px 4px;max-width:480px;margin:auto;display:flex;flex-direction:column;gap:18px;color:#222}.update-brand{margin-top:20px;object-fit:contain}.update-eyebrow{font-size:10px;letter-spacing:.2em;color:#8b8b8b;margin:0}.update-view h1{font-size:25px;line-height:1.4;margin:0;font-weight:600;letter-spacing:-.03em}.update-copy,.update-retained,.update-install{font-size:12px;line-height:1.85;color:#777;margin:0}.update-retained{padding:14px 16px;background:#f6f6f6;border-radius:12px;color:#555}.update-versions{display:grid;grid-template-columns:1fr 1fr;border-block:1px solid #ececec;padding:16px 0;gap:16px;margin:4px 0}.update-versions dt{font-size:11px;color:#888}.update-versions dd{margin:7px 0 0;font-size:17px;font-variant-numeric:tabular-nums}.update-notes h2{font-size:12px;font-weight:600}.update-notes ul{margin:0;padding-left:18px;font-size:12px;line-height:1.9;color:#666}.update-actions{display:grid;gap:10px}.update-actions button{padding:13px 16px;border-radius:10px;font:inherit;font-size:13px;cursor:pointer;transition:background .15s ease,transform .15s ease}.update-primary{background:#222;border:1px solid #222;color:#fff}.update-secondary{background:white;border:1px solid #ddd;color:#444}.update-actions button:hover:not(:disabled){transform:translateY(-1px)}.update-actions button:disabled{opacity:.45;cursor:default}.update-install{font-size:11px}.update-logout{align-self:center;background:none;border:0;color:#777;font-size:12px;padding:8px;cursor:pointer}.update-view button:focus-visible{outline:2px solid #555;outline-offset:3px}@media(prefers-reduced-motion:reduce){.update-actions button{transition:none;transform:none!important}}
</style>
