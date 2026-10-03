import { HttpError } from './errors.mjs'

export const API_ORIGIN = 'https://api.sgroup.qq.com'
export const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken'

export class QQClient {
  constructor({ appId, secret, fetchImpl = fetch }) {
    this.appId = appId
    this.secret = secret
    this.fetch = fetchImpl
    this.token = ''
    this.expiresAt = 0
    this.refreshing = null
    this.closed = false
  }

  redact(value) {
    let result = String(value || '')
    for (const sensitive of [this.secret, this.token]) if (sensitive) result = result.split(sensitive).join('[redacted]')
    return result.slice(0, 500)
  }

  async json(url, options) {
    let response
    try { response = await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }) }
    catch { throw new HttpError(502, '无法连接 QQ 官方接口，请检查网络后重试') }
    let data
    try {
      const content = response.status === 204 ? '' : await response.text()
      data = content.trim() ? JSON.parse(content) : {}
    }
    catch { throw new HttpError(502, 'QQ 官方接口返回了无效响应') }
    if (!response.ok || (data?.code != null && Number(data.code) !== 0)) {
      const detail = this.redact(data?.message || data?.msg || '请求未被接受')
      const error = new HttpError(response.status === 429 ? 429 : 502, `QQ 接口错误（${data?.code ?? response.status}）：${detail}`)
      error.upstreamStatus = response.status
      throw error
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(502, 'QQ 官方接口返回了无效响应')
    return data
  }

  async accessToken() {
    if (this.closed) throw new HttpError(401, '会话已结束，请重新登录')
    if (this.token && Date.now() < this.expiresAt) return this.token
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const data = await this.json(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: this.appId, clientSecret: this.secret }) })
        const lifetime = Number(data.expires_in)
        if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(lifetime) || lifetime <= 0) {
          throw new HttpError(502, '获取访问令牌失败，请检查 AppID 和 AppSecret')
        }
        if (this.closed) throw new HttpError(401, '会话已结束，请重新登录')
        this.token = data.access_token
        this.expiresAt = Date.now() + (lifetime - Math.min(120, lifetime / 2)) * 1000
        return this.token
      })().finally(() => { this.refreshing = null })
    }
    return this.refreshing
  }

  async request(path, method = 'GET', body) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path')
    const invoke = async () => this.json(API_ORIGIN + path, {
      method,
      headers: { Authorization: `QQBot ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    try { return await invoke() }
    catch (error) {
      if (method !== 'GET' || error.upstreamStatus !== 401) throw error
      this.expiresAt = 0
      return invoke()
    }
  }

  close() { this.closed = true; this.secret = ''; this.token = ''; this.expiresAt = 0 }
}

export function menuToApi(menu) {
  const item = entry => ({ name: entry.name, type: entry.type,
    ...(entry.align ? { align: entry.align } : {}),
    ...(entry.type === 'send_message' ? { send_message: entry.sendMessage } : {}),
    ...(entry.type === 'link' ? { link: entry.link } : {}),
    ...(entry.type === 'switch' ? { switch: { switch_id: entry.switchConfig.switchId, default: entry.switchConfig.defaultOn } } : {}),
    ...(entry.type === 'menu' ? { sub_menu_items: entry.subMenuItems.map(item) } : {}) })
  return { items: menu.items.map(item) }
}

export function menuFromApi(data) {
  const item = entry => ({ name: entry.name, type: entry.type, align: entry.align, sendMessage: entry.send_message, link: entry.link,
    subMenuItems: entry.sub_menu_items?.map(item),
    switchConfig: entry.switch ? { switchId: entry.switch.switch_id, defaultOn: !!entry.switch.default } : null })
  return { menu: data.menu ? { items: (data.menu.items || []).map(item) } : null, version: data.version || 0 }
}

export function panelToApi(panel) {
  return { items: panel.items.map(item => ({ name: item.name, type: item.type, only_admin: item.onlyAdmin,
    ...(item.desc ? { desc: item.desc } : {}), ...(item.type === 'link' ? { link: item.link } : {}) })),
  ...(panel.remark ? { remark: panel.remark } : {}) }
}

export function panelFromApi(data) {
  return { panelId: data.panel_id, scope: data.scope, targetType: data.target_type || 'all', version: data.version || 0,
    createdAt: data.created_at, updatedAt: data.updated_at,
    userOpenIds: data.user_openids || [], groupOpenIds: data.group_openids || [],
    panel: { remark: data.panel?.remark || '', items: (data.panel?.items || []).map(item => ({ name: item.name, desc: item.desc, type: item.type, onlyAdmin: !!item.only_admin, link: item.link })) } }
}

export async function listPanels(client, scope, cursor = '', limit = 50) {
  const query = new URLSearchParams({ scope, limit: String(limit) })
  if (cursor) query.set('cursor', cursor)
  const data = await client.request(`/v2/panels?${query}`)
  const records = data.records ?? []
  if (!Array.isArray(records)) throw new HttpError(502, '指令面板列表 records 字段格式无效')
  return { records: records.map(panelFromApi), nextCursor: data.next_cursor || '', isEnd: data.is_end ?? !data.next_cursor }
}

export async function hasGlobalPanel(client, scope) {
  let cursor = ''
  const seen = new Set()
  for (let page = 0; page < 100; page++) {
    const data = await listPanels(client, scope, cursor)
    if (data.records.some(panel => panel.targetType === 'all')) return true
    if (data.isEnd || !data.nextCursor) return false
    if (seen.has(data.nextCursor)) throw new HttpError(502, '指令面板分页游标重复，操作已停止')
    seen.add(data.nextCursor)
    cursor = data.nextCursor
  }
  throw new HttpError(502, '指令面板分页超过读取上限')
}
