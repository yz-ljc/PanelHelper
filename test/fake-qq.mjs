export function createFakeQQ(profile = { id: 'bot-1', union_openid: 'bot-open-id', username: '示例机器人', avatar: '', welcome_msg: '菜单与指令面板管理' }) {
  const calls = []
  let version = 1, nextId = 2
  let menu = { items: [{ name: '帮助', type: 'send_message', send_message: '/help', align: 'left' },
    { name: '更多', type: 'menu', align: 'left', sub_menu_items: [{ name: '使用说明', type: 'link', link: 'https://example.com/help' }] }] }
  const panels = [{ panel_id: 'panel-1', scope: 'group', target_type: 'specific', version: 1, group_openids: ['group-1'], panel: { remark: '群聊面板', items: [{ name: 'help', desc: '查看帮助', type: 'command', only_admin: false }] } }]
  const respond = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
  async function fetchImpl(rawUrl, options) {
    const url = new URL(rawUrl), method = options.method || 'GET'
    const body = options.body ? JSON.parse(options.body) : null
    calls.push({ url: url.href, path: url.pathname, method, body, authorization: options.headers?.Authorization })
    if (url.pathname === '/app/getAppAccessToken') {
      if (body.clientSecret !== 'test-secret') return respond({ code: 400, message: 'invalid secret' }, 400)
      return respond({ access_token: 'mock-access-token', expires_in: 7200 })
    }
    if (options.headers.Authorization !== 'QQBot mock-access-token') return respond({ message: 'Unauthorized' }, 401)
    if (url.pathname === '/users/@me') return respond(profile)
    if (url.pathname === '/v2/menu') {
      if (method === 'PUT') { menu = body.menu; version++; return respond({ version }) }
      return respond({ menu, version })
    }
    if (url.pathname === '/v2/panels') {
      if (method === 'GET') {
        const records = panels.filter(panel => panel.scope === url.searchParams.get('scope'))
        return respond({ ...(records.length ? { records } : {}), is_end: true, next_cursor: '' })
      }
      const panel_id = `panel-${nextId++}`
      panels.push({ panel_id, version: 1, ...body })
      return respond({ panel_id })
    }
    const match = url.pathname.match(/^\/v2\/panels\/([^/]+)(\/target)?$/)
    if (match) {
      const panel = panels.find(item => item.panel_id === match[1])
      if (!panel) return respond({ message: 'Not found' }, 404)
      if (match[2]) {
        const key = panel.scope === 'c2c' ? 'user_openids' : 'group_openids'
        panel[key] = body.op === 'add' ? [...new Set([...(panel[key] || []), ...body[key]])] : (panel[key] || []).filter(id => !body[key].includes(id))
        return respond({}, 204)
      }
      if (method === 'GET') return respond(panel)
      if (method === 'PUT') { panel.panel = body.panel; return respond({ version: ++panel.version }) }
      if (method === 'DELETE') { panels.splice(panels.indexOf(panel), 1); return respond({}, 204) }
    }
    return respond({ message: 'Unknown endpoint' }, 404)
  }
  return { fetchImpl, calls, panels }
}
