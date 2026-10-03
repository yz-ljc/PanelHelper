import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createAppServer } from './app.mjs'

const root = resolve(import.meta.dirname, '..')
const dev = process.argv.includes('--dev')
const port = Number(process.env.PANEL_HELPER_PORT || 4973)
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('PANEL_HELPER_PORT must be an integer between 1024 and 65535.')
  process.exit(1)
}
if (!dev && !existsSync(resolve(root, 'dist/index.html'))) {
  console.error('Frontend assets are missing. Run npm ci and npm run build first.')
  process.exit(1)
}
const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' }) : null
const server = createAppServer({ middleware: vite?.middlewares })
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Set PANEL_HELPER_PORT to use another port.` : 'Unable to start the local server.')
  process.exit(1)
})
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log(`指令面板设置: ${url}\nPress Ctrl+C to stop.`)
  if (process.argv.includes('--open')) {
    const [command, args] = process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => console.log(`Open ${url} in your browser.`))
    child.unref()
  }
})
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  await vite?.close()
  server.close()
  server.closeAllConnections()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
