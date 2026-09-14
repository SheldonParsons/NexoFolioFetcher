import { defineConfig } from 'wxt'

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  modules: ['@wxt-dev/module-vue'],
  webExt: { disabled: true },
  manifest: {
    name: 'NexoFolio Fetcher',
    description: '在浏览器侧边栏中连接和配置 NexoFolio。',
    minimum_chrome_version: '125',
    permissions: ['sidePanel', 'storage', 'tabs', 'scripting', 'webNavigation'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: {
      default_title: '打开 NexoFolio Fetcher',
      default_icon: {
        16: 'icons/16.png',
        32: 'icons/32.png',
        48: 'icons/48.png',
        128: 'icons/128.png',
      },
    },
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
  },
})
