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

const licenses = await Promise.all(['vue', 'reka-ui', 'morphicons', 'lucide'].map(async (name) => {
  const license = await readFile(new URL(`../node_modules/${name}/LICENSE`, import.meta.url), 'utf8')
  return `${name}\n${license}`
}))
await writeFile(new URL('../public/third-party-licenses.txt', import.meta.url), licenses.join('\n\n'))
