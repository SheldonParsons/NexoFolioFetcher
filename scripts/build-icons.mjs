import { mkdir, readFile, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

// Chrome manifest icons require raster assets. Keep the supplied SVG unchanged.
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true })
for (const size of [16, 32, 48, 128]) {
  await sharp(new URL('../public/nexofolio-icon.svg', import.meta.url).pathname, { density: 384 })
    .resize(size, size, { fit: 'contain', background: '#ffffff00' })
    .png()
    .toFile(new URL(`../public/icons/${size}.png`, import.meta.url).pathname)
}

const packages = new Set(['vue', 'reka-ui', 'morphicons', 'lucide', 'ajv', 'ajv-formats', 'fast-deep-equal'])
async function includeEditorPackage(name) {
  if (packages.has(name)) return
  packages.add(name)
  const info = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'))
  for (const dependency of Object.keys(info.dependencies || {})) await includeEditorPackage(dependency)
}
for (const name of ['state', 'view', 'commands', 'language', 'lang-json', 'search']) await includeEditorPackage(`@codemirror/${name}`)
const licenses = await Promise.all([...packages].map(async (name) => {
  const license = await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), 'utf8')
  return `${name}\n${license}`
}))
await writeFile(new URL('../public/third-party-licenses.txt', import.meta.url), licenses.join('\n\n'))
