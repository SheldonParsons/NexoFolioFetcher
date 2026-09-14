export interface ServiceConfig {
  name: string
  url: string
}

export const SERVICE_STORAGE_KEY = 'asynctest.service.v1'

export function normalizeServiceUrl(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('请输入 NexoFolio 服务地址。')
  if (!/^https?:\/\//i.test(value)) throw new Error('地址需要以 https:// 或 http:// 开头。')
  if (/\s/.test(value)) throw new Error('地址中不能包含空格。')

  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入有效的服务地址。') }
  if (!url.hostname) throw new Error('请输入有效的服务地址。')
  if (url.username || url.password) throw new Error('服务地址中不能包含账号或密码。')
  if (url.search || url.hash) throw new Error('请填写服务基础地址，不包含查询参数或 # 后的内容。')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

export function parseServiceConfig(value: unknown): ServiceConfig | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || !('url' in value) || !('name' in value)
      || typeof value.url !== 'string' || typeof value.name !== 'string') {
    throw new Error('已保存的服务配置无法读取，请重新配置。')
  }
  return { name: value.name, url: normalizeServiceUrl(value.url) }
}

export async function loadService(): Promise<ServiceConfig | null> {
  const stored = await chrome.storage.local.get(SERVICE_STORAGE_KEY)
  return parseServiceConfig(stored[SERVICE_STORAGE_KEY])
}

export async function saveService(config: ServiceConfig): Promise<ServiceConfig> {
  const normalized = { name: config.name.trim(), url: normalizeServiceUrl(config.url) }
  await chrome.storage.local.set({ [SERVICE_STORAGE_KEY]: normalized })
  return normalized
}
