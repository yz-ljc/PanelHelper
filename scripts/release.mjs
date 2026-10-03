import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const build = spawnSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const prefix = `panel-helper-${version}`
const entries = []
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = resolve(path, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (entry.isFile()) entries.push([relative(root, file).replaceAll('\\', '/'), await readFile(file)])
  }
}
for (const dir of ['dist', 'server', 'shared', 'docs']) await collect(resolve(root, dir))
for (const file of ['README.md', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', 'start.cmd', 'start.sh', 'package.json']) entries.push([file, await readFile(resolve(root, file))])

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

const local = [], central = []
let offset = 0
for (const [name, content] of entries.sort(([a], [b]) => a.localeCompare(b))) {
  const filename = Buffer.from(`${prefix}/${name}`), crc = crc32(content)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
  header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(content.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(filename.length, 26)
  const directory = Buffer.alloc(46)
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8)
  directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(content.length, 20); directory.writeUInt32LE(content.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42)
  local.push(header, filename, content); central.push(directory, filename)
  offset += header.length + filename.length + content.length
}
const index = Buffer.concat(central), end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16)
const archive = Buffer.concat([...local, index, end])
const release = resolve(root, 'release')
await mkdir(release, { recursive: true })
const filename = `${prefix}.zip`
await writeFile(resolve(release, filename), archive)
await writeFile(resolve(release, `${filename}.sha256`), `${createHash('sha256').update(archive).digest('hex')}  ${filename}\n`)
console.log(`Release archive: release/${filename}`)
