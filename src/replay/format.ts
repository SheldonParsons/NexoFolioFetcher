// Validate, then indent lexical tokens. Never reserialize parsed numbers (64-bit IDs lose precision).
export function formatJson(source: string): string {
  JSON.parse(source)
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+/g) || []
  let depth = 0, result = ''
  const line = () => '\n' + '  '.repeat(depth)
  for (let index = 0; index < tokens.length; index++) {
    if (depth > 128 || result.length > 2 * 1024 * 1024) throw new Error('JSON 格式化超过显示上限。')
    const token = tokens[index], previous = tokens[index - 1], next = tokens[index + 1]
    if (token === '{' || token === '[') { result += token; depth++; if (next !== (token === '{' ? '}' : ']')) result += line() }
    else if (token === '}' || token === ']') { depth--; if (previous !== (token === '}' ? '{' : '[')) result += line(); result += token }
    else if (token === ',') result += ',' + line()
    else if (token === ':') result += ': '
    else result += token
  }
  return result
}
