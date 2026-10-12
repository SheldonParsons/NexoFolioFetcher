import { browserManagedHeader } from './contracts'

const printable = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, character =>
  character === '\t' ? '\t' : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
const unsafeLine = (value: string) => /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
const trimSpacing = (value: string) => value.replace(/^[\t ]+|[\t ]+$/g, '')

// One logical line per header. Draft-only comments keep managed/unrepresentable originals visible.
export function formatHeaderLines(entries: [string, string][], draft = false): string {
  return entries.map(([name, value]) => {
    const disabled = draft && (browserManagedHeader(name, value) || unsafeLine(name) || unsafeLine(value))
    return `${disabled ? '# ' : ''}${printable(name)}: ${printable(value)}`
  }).join('\n')
}
export function parseHeaderLines(text: string): [string, string][] {
  if (text.length > 256 * 1024) throw new Error('Headers 编辑文本超过 256 KiB。')
  const entries: [string, string][] = []
  for (const [index, raw] of text.split(/\r\n|\n|\r/).entries()) {
    const line = trimSpacing(raw)
    if (!line || line === '#' || line.startsWith('# ')) continue
    const colon = line.indexOf(':')
    if (colon <= 0) throw new Error(`第 ${index + 1} 行 Header 应为「名称: 值」。`)
    const name = trimSpacing(line.slice(0, colon)), value = trimSpacing(line.slice(colon + 1))
    if (browserManagedHeader(name, value)) throw new Error(`第 ${index + 1} 行属于浏览器管理的 Header，请在行首加「# 」停用。`)
    entries.push([name, value])
    if (entries.length > 256) throw new Error('启用的请求 Header 最多 256 项。')
  }
  return entries
}
export function withContentType(text: string, value: string): string {
  const lines = text ? text.split(/\r\n|\n|\r/) : []
  const index = lines.findIndex(line => /^[\t ]*(?:#[\t ]+)?content-type[\t ]*:/i.test(line))
  const replacement = `Content-Type: ${value}`
  if (index < 0) lines.push(replacement)
  else lines[index] = replacement
  return lines.join('\n')
}
