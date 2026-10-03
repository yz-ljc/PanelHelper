import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { HttpError } from './errors.mjs'
import { QQClient, menuFromApi, menuToApi, panelFromApi, panelToApi, listPanels, hasGlobalPanel } from './qq-client.mjs'
import { validateScope, validateMenu, validatePanel, validateCreate, validateIds } from '../shared/validation.mjs'

const SESSION_TTL = 8 * 60 * 60 * 1000
const MAX_BODY = 1024 * 1024
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

function cookieId(request) {
  return request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('panel_session='))?.slice(14) || ''
}

function equal(a, b) {
  const left = Buffer.from(String(a || '')), right = Buffer.from(String(b || ''))
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(response, status, data, message = 'ok') {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify({ status, message, data }))
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, '请求必须使用 application/json')
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, '请求内容超过 1 MiB')
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new HttpError(400, '请求内容必须为 JSON 对象') }
}

function validate(fn) {
  try { return fn() } catch (error) { throw new HttpError(400, error.message) }
}

function safeHttps(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '' } catch { return '' }
}

export function createAppServer({ fetchImpl = fetch, distDir = resolve(import.meta.dirname, '../dist'), middleware } = {}) {
  const sessions = new Map()
  const writes = new Map()
  let loginPending = false
  let loginAttempts = []

  function destroy(id) {
    sessions.get(id)?.client.close()
    sessions.delete(id)
  }
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions) if (Date.now() >= session.expiresAt) destroy(id)
  }, 60000).unref()

  async function serialize(key, operation) {
    const previous = writes.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(operation)
    writes.set(key, next)
    try { return await next } finally { if (writes.get(key) === next) writes.delete(key) }
  }

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${middleware ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'${middleware ? ' ws:' : ''}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`)
    try {
      const port = server.address().port
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)) throw new HttpError(403, '仅允许通过本地地址访问')
      const origin = `http://${request.headers.host}`
      if (request.headers.origin && request.headers.origin !== origin) throw new HttpError(403, '不允许跨来源访问')
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不允许跨站请求')
      const url = new URL(request.url, origin)
      const method = request.method
      if (!url.pathname.startsWith('/api/')) {
        if (middleware) return middleware(request, response, () => json(response, 404, null, '资源不存在'))
        if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, '不支持的请求方法')
        let pathname
        try { pathname = decodeURIComponent(url.pathname) } catch { throw new HttpError(400, '请求路径无效') }
        const file = resolve(distDir, '.' + (pathname === '/' ? '/index.html' : pathname))
        if (!file.startsWith(resolve(distDir) + sep)) throw new HttpError(403, '资源路径无效')
        let bytes
        try { if (!(await stat(file)).isFile()) throw new Error(); bytes = await readFile(file) }
        catch { throw new HttpError(404, '资源不存在，请先执行 npm run build') }
        response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
        response.end(method === 'HEAD' ? undefined : bytes)
        return
      }

      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const input = await body(request)
        if (!/^\d{1,32}$/.test(input.appId || '') || typeof input.secret !== 'string' || !input.secret.trim() || input.secret.length > 256) throw new HttpError(400, '请输入有效的 AppID 和 AppSecret')
        loginAttempts = loginAttempts.filter(time => Date.now() - time < 60000)
        if (loginPending || loginAttempts.length >= 10) throw new HttpError(429, '登录请求过于频繁，请稍后重试')
        if (sessions.size >= 10 && !sessions.has(cookieId(request))) throw new HttpError(429, '本地会话数量已达上限，请退出已有会话')
        loginPending = true
        loginAttempts.push(Date.now())
        const client = new QQClient({ appId: String(input.appId), secret: input.secret, fetchImpl })
        try {
          const profile = await client.request('/users/@me')
          if (!profile.username) throw new HttpError(502, '机器人资料响应不完整')
          const openId = typeof profile.union_openid === 'string' ? profile.union_openid.trim() : ''
          const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex')
          const bot = { appId: client.appId, name: String(profile.username), openId, avatar: safeHttps(profile.avatar), shareUrl: safeHttps(profile.share_url), description: String(profile.welcome_msg || '') }
          destroy(cookieId(request))
          sessions.set(id, { client, bot, csrf, expiresAt: Date.now() + SESSION_TTL })
          response.setHeader('Set-Cookie', `panel_session=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL / 1000}`)
          json(response, 200, { bot, csrf })
        } catch (error) { client.close(); throw error }
        finally { input.secret = ''; loginPending = false }
        return
      }

      const id = cookieId(request)
      const session = sessions.get(id)
      if (!session || Date.now() >= session.expiresAt) { destroy(id); throw new HttpError(401, '请先登录机器人') }
      if (!['GET', 'HEAD'].includes(method) && !equal(request.headers['x-panel-csrf'], session.csrf)) throw new HttpError(403, '会话校验失败，请刷新页面后重试')
      const client = session.client
      let data
      if (url.pathname === '/api/session' && method === 'GET') data = { bot: session.bot, csrf: session.csrf }
      else if (url.pathname === '/api/auth/logout' && method === 'POST') {
        destroy(id)
        response.setHeader('Set-Cookie', 'panel_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0')
        data = null
      } else if (url.pathname === '/api/menu' && method === 'GET') data = menuFromApi(await client.request('/v2/menu'))
      else if (url.pathname === '/api/menu' && method === 'PUT') {
        const input = await body(request)
        const menu = validate(() => validateMenu(input.menu))
        const result = await client.request('/v2/menu', 'PUT', { menu: menuToApi(menu) })
        if (!Number.isInteger(result.version)) throw new HttpError(502, '菜单保存响应缺少版本号，请重新加载确认结果')
        data = result.version
      } else if (url.pathname === '/api/panels' && method === 'GET') {
        const scope = validate(() => validateScope(url.searchParams.get('scope')))
        const limit = Number(url.searchParams.get('limit') || 50)
        const cursor = url.searchParams.get('cursor') || ''
        if (!Number.isInteger(limit) || limit < 1 || limit > 50 || cursor.length > 2048) throw new HttpError(400, '分页参数无效')
        data = await listPanels(client, scope, cursor, limit)
      } else if (url.pathname === '/api/panels' && method === 'POST') {
        const raw = await body(request)
        const input = validate(() => validateCreate(raw))
        data = await serialize(`${client.appId}:${input.scope}`, async () => {
          if (input.targetType === 'all' && await hasGlobalPanel(client, input.scope)) throw new HttpError(409, '该场景已存在全局面板，请编辑现有面板')
          const result = await client.request('/v2/panels', 'POST', {
            scope: input.scope, target_type: input.targetType, panel: panelToApi(input.panel),
            ...(input.userOpenIds.length ? { user_openids: input.userOpenIds } : {}),
            ...(input.groupOpenIds.length ? { group_openids: input.groupOpenIds } : {})
          })
          if (!result.panel_id) throw new HttpError(502, '面板创建响应缺少 ID，请刷新列表确认结果')
          return result.panel_id
        })
      } else {
        const match = url.pathname.match(/^\/api\/panels\/([A-Za-z0-9_-]{1,256})(\/target)?$/)
        if (!match) throw new HttpError(404, '接口不存在')
        const [, panelId, target] = match
        const upstream = `/v2/panels/${panelId}`
        if (!target && method === 'GET') data = panelFromApi(await client.request(upstream))
        else if (!target && method === 'PUT') {
          const input = await body(request)
          const panel = validate(() => validatePanel(input.panel))
          const result = await client.request(upstream, 'PUT', { panel: panelToApi(panel) })
          if (!Number.isInteger(result.version)) throw new HttpError(502, '面板保存响应缺少版本号，请重新加载确认结果')
          data = result.version
        } else if (!target && method === 'DELETE') {
          if (panelId.startsWith('mp_')) throw new HttpError(400, '旧版面板不支持删除')
          await client.request(upstream, 'DELETE')
          data = null
        } else if (target && method === 'PUT') {
          const input = await body(request)
          if (!['add', 'del'].includes(input.op)) throw new HttpError(400, '关联操作必须为 add 或 del')
          const users = validate(() => validateIds(input.userOpenIds, '用户关联对象'))
          const groups = validate(() => validateIds(input.groupOpenIds, '群关联对象'))
          const detail = panelFromApi(await client.request(upstream))
          if (detail.targetType !== 'specific' || !['c2c', 'group'].includes(detail.scope)) throw new HttpError(400, '当前面板不支持关联对象')
          if (detail.scope === 'c2c' ? !users.length || groups.length : !groups.length || users.length) throw new HttpError(400, '关联对象与面板场景不匹配')
          await client.request(upstream + '/target', 'PUT', { op: input.op, ...(users.length ? { user_openids: users } : {}), ...(groups.length ? { group_openids: groups } : {}) })
          data = null
        } else throw new HttpError(405, '不支持的请求方法')
      }
      json(response, 200, data)
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof HttpError ? error.status : 500, null, error instanceof HttpError ? error.message : '本地服务处理失败，请重启工具后重试')
      else response.end()
    }
  })
  server.on('close', () => { clearInterval(cleanup); for (const id of sessions.keys()) destroy(id) })
  server.requestTimeout = 30000
  server.headersTimeout = 10000
  return server
}
