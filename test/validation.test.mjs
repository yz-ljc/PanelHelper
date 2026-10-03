import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTransferDocument, parseTransferDocument } from '../shared/menu-panel-transfer.mjs'
import { validateCreate, validateMenu } from '../shared/validation.mjs'

test('configuration documents remain compatible with AtriMeow exports', () => {
  const input = { menu: { items: [{ name: '帮助', type: 'send_message', sendMessage: '/help' }] }, panels: [] }
  const document = createTransferDocument(input)
  assert.equal(document.format, 'atribot-menu-panel')
  assert.equal(parseTransferDocument(JSON.stringify(document)).menu.items[0].sendMessage, '/help')
  assert.throws(() => parseTransferDocument('{"format":"unknown"}'), /配置文件/)
})

test('menu length, duplicate switches and panel target validation', () => {
  assert.throws(() => validateMenu({ items: [{ name: '超过五个中文字符', type: 'send_message', sendMessage: '/help' }] }), /过长/)
  const item = { name: '开关', type: 'switch', switchConfig: { switchId: 'same', defaultOn: false } }
  assert.throws(() => validateMenu({ items: [item, item] }), /不能重复/)
  assert.throws(() => validateCreate({ scope: 'group', targetType: 'specific', panel: { items: [{ name: 'help', type: 'command' }] } }), /关联对象/)
  assert.throws(() => validateCreate({ scope: 'group', targetType: 'specific', groupOpenIds: Array(21).fill('id'), panel: { items: [{ name: 'help', type: 'command' }] } }), /20/)
})
