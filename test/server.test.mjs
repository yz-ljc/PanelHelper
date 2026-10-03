import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { createAppServer } from '../server/app.mjs'
import { QQClient, hasGlobalPanel, listPanels } from '../server/qq-client.mjs'
import { createFakeQQ } from './fake-qq.mjs'

async function fixture(t, profile) {
  const qq = createFakeQQ(profile), server = createAppServer({ fetchImpl: qq.fetchImpl })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const origin = `http://127.0.0.1:${server.address().port}`
  let cookie = '', csrf = ''
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(origin + '/api' + path, { method,
      headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'X-Panel-CSRF': csrf, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const payload = await response.json()
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0]
    if (payload.data?.csrf) csrf = payload.data.csrf
    return { response, ...payload }
  }
  async function login() { return request('/auth/login', 'POST', { appId: '123456', secret: 'test-secret' }) }
  return { qq, origin, request, login }
}

test('authentication, credential isolation, request origin and logout', async t => {
  const { request, login, qq, origin } = await fixture(t)
  assert.equal((await request('/menu')).status, 401)
  assert.equal((await request('/auth/login', 'POST', { appId: '123456', secret: 'wrong' })).status, 502)
  const result = await login()
  assert.equal(result.status, 200)
  assert.equal(result.data.bot.name, '示例机器人')
  assert.equal(result.data.bot.openId, 'bot-open-id')
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.ok(!JSON.stringify(result.data).includes('secret'))
  assert.ok(!JSON.stringify(result.data).includes('mock-access-token'))
  assert.equal((await request('/session')).status, 200)
  assert.equal((await request('/menu', 'GET', undefined, { Origin: 'https://example.com' })).status, 403)
  assert.equal((await request('/auth/logout', 'POST', undefined, { 'X-Panel-CSRF': '' })).status, 403)
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(origin + '/api/session', { headers: { Host: 'attacker.example' } }, response => {
      response.resume()
      resolve(response.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(hostStatus, 403)
  assert.equal(qq.calls.filter(call => call.path === '/app/getAppAccessToken').length, 2)
  assert.equal((await request('/auth/logout', 'POST')).status, 200)
  assert.equal((await request('/session')).status, 401)
})

test('missing union_openid permits login without using profile id as an avatar OpenID', async t => {
  for (const profile of [
    { username: '示例机器人' },
    { username: '示例机器人', id: 'different-id' },
    { username: '示例机器人', id: 'different-id', union_openid: null },
    { username: '示例机器人', id: 'different-id', union_openid: '  ' }
  ]) {
    const { login, request } = await fixture(t, profile)
    const result = await login()
    assert.equal(result.status, 200)
    assert.equal(result.data.bot.openId, '')
    assert.equal((await request('/session')).data.bot.openId, '')
  }
})

test('menu serialization preserves nested items and switch fields', async t => {
  const { request, login, qq } = await fixture(t)
  await login()
  const menu = { items: [
    { name: '更多', type: 'menu', align: 'right', subMenuItems: [{ name: '帮助', type: 'send_message', sendMessage: '/help' }] },
    { name: '开关', type: 'switch', switchConfig: { switchId: 'search', defaultOn: true } }
  ] }
  assert.equal((await request('/menu', 'PUT', { menu })).data, 2)
  const saved = (await request('/menu')).data.menu
  assert.equal(saved.items[0].subMenuItems[0].sendMessage, '/help')
  assert.deepEqual(saved.items[1].switchConfig, { switchId: 'search', defaultOn: true })
  const write = qq.calls.find(call => call.path === '/v2/menu' && call.method === 'PUT')
  assert.ok(write.url.startsWith('https://api.sgroup.qq.com/'))
  assert.equal(write.body.menu.items[1].switch.default, true)
  assert.equal((await request('/menu', 'PUT', { menu: { items: [{ name: '链接', type: 'link', link: 'javascript:alert(1)' }] } })).status, 400)
  assert.equal((await request('/menu', 'PUT', { menu: { items: [] } })).status, 400)
})

test('panel CRUD, scene constraints, target changes and global protection', async t => {
  const { request, login, qq } = await fixture(t)
  await login()
  const panel = { remark: '测试面板', items: [{ name: 'help', desc: '查看帮助', type: 'command', onlyAdmin: true }] }
  for (const scope of ['c2c', 'group', 'channel', 'dm']) {
    const created = await request('/panels', 'POST', { scope, targetType: 'all', panel })
    assert.equal(created.status, 200)
    assert.equal((await request('/panels', 'POST', { scope, targetType: 'all', panel })).status, 409)
    assert.ok((await request(`/panels?scope=${scope}`)).data.records.some(record => record.panelId === created.data))
  }
  assert.equal((await request('/panels', 'POST', { scope: 'dm', targetType: 'specific', userOpenIds: ['user-1'], panel })).status, 400)
  const created = await request('/panels', 'POST', { scope: 'c2c', targetType: 'specific', userOpenIds: ['user-1'], panel })
  assert.equal(created.status, 200)
  const path = `/panels/${created.data}`
  assert.equal((await request(path)).data.panel.items[0].onlyAdmin, true)
  assert.equal((await request(path + '/target', 'PUT', { op: 'invalid', userOpenIds: ['user-2'] })).status, 400)
  assert.equal((await request(path + '/target', 'PUT', { op: 'add', groupOpenIds: ['group-1'] })).status, 400)
  assert.equal((await request(path + '/target', 'PUT', { op: 'add', userOpenIds: ['user-2'] })).status, 200)
  assert.deepEqual((await request(path)).data.userOpenIds, ['user-1', 'user-2'])
  assert.equal((await request(path + '/target', 'PUT', { op: 'del', userOpenIds: ['user-1'] })).status, 200)
  assert.deepEqual((await request(path)).data.userOpenIds, ['user-2'])
  assert.equal((await request(path, 'PUT', { panel: { ...panel, remark: '已更新' } })).status, 200)
  assert.equal((await request('/panels/mp_legacy', 'DELETE')).status, 400)
  assert.equal((await request(path, 'DELETE')).status, 200)
  assert.ok(!qq.panels.some(item => item.panel_id === created.data))
})

test('concurrent global panel creation cannot overwrite an existing panel', async t => {
  const { request, login } = await fixture(t)
  await login()
  const body = { scope: 'dm', targetType: 'all', panel: { items: [{ name: 'help', type: 'command' }] } }
  const responses = await Promise.all([request('/panels', 'POST', body), request('/panels', 'POST', body)])
  assert.deepEqual(responses.map(value => value.status).sort(), [200, 409])
})

test('token refresh is shared across requests and credentials are cleared', async () => {
  const qq = createFakeQQ(), client = new QQClient({ appId: '123456', secret: 'test-secret', fetchImpl: qq.fetchImpl })
  await Promise.all([client.request('/users/@me'), client.request('/users/@me')])
  assert.equal(qq.calls.filter(call => call.path === '/app/getAppAccessToken').length, 1)
  client.expiresAt = 0
  await client.request('/users/@me')
  assert.equal(qq.calls.filter(call => call.path === '/app/getAppAccessToken').length, 2)
  client.close()
  assert.equal(client.secret, '')
  assert.equal(client.token, '')
  await assert.rejects(client.accessToken(), /会话已结束/)
})

test('empty panel lists accept omitted or null records and preserve pagination', async () => {
  for (const response of [{}, { is_end: true }, { records: null, is_end: true }, { records: [], is_end: true }]) {
    assert.deepEqual(await listPanels({ request: async () => response }, 'c2c'), { records: [], nextCursor: '', isEnd: true })
  }
  const partial = await listPanels({ request: async () => ({ is_end: false, next_cursor: 'page-2' }) }, 'group')
  assert.deepEqual(partial, { records: [], nextCursor: 'page-2', isEnd: false })
  await assert.rejects(listPanels({ request: async () => ({ records: {} }) }, 'c2c'), /records 字段格式无效/)
})

test('global panel detection traverses pages and fails on repeated cursors', async () => {
  let page = 0
  const client = { request: async () => ++page === 1
    ? { is_end: false, next_cursor: 'page-2' }
    : { records: [{ panel_id: 'global', target_type: 'all', scope: 'c2c' }], is_end: true } }
  assert.equal(await hasGlobalPanel(client, 'c2c'), true)
  assert.equal(page, 2)
  await assert.rejects(hasGlobalPanel({ request: async () => ({ records: [], is_end: false, next_cursor: 'same' }) }, 'c2c'), /游标重复/)
})

test('expired reads refresh once, writes are not replayed, and errors redact credentials', async () => {
  let tokens = 0, reads = 0, writes = 0
  const client = new QQClient({ appId: '123456', secret: 'test-secret', fetchImpl: async (url, options) => {
    if (url.endsWith('/app/getAppAccessToken')) return Response.json({ access_token: `token-${++tokens}`, expires_in: 7200 })
    if (options.method === 'GET') return ++reads === 1 ? Response.json({ message: 'expired' }, { status: 401 }) : Response.json({ version: 1 })
    writes++
    return Response.json({ message: 'test-secret token-2' }, { status: 401 })
  } })
  assert.equal((await client.request('/v2/menu')).version, 1)
  assert.equal(tokens, 2)
  assert.equal(reads, 2)
  await assert.rejects(client.request('/v2/menu', 'PUT', {}), error => !error.message.includes('test-secret') && !error.message.includes('token-2'))
  assert.equal(writes, 1)
  assert.equal(tokens, 2)
  client.close()
})

test('successful empty upstream responses are accepted', async () => {
  const client = new QQClient({ appId: '123456', secret: 'test-secret', fetchImpl: async url =>
    url.endsWith('/app/getAppAccessToken') ? Response.json({ access_token: 'token', expires_in: 7200 }) : new Response(null, { status: 200 }) })
  assert.deepEqual(await client.request('/v2/panels/panel-1', 'DELETE'), {})
  client.close()
})
