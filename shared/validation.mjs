import { parseTransferDocument, TRANSFER_FORMAT, TRANSFER_VERSION } from './menu-panel-transfer.mjs'

export const SCOPES = ['c2c', 'group', 'channel', 'dm']

export function validateScope(value) {
  if (!SCOPES.includes(value)) throw new Error('不支持的生效场景')
  return value
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}不能为空`)
}

function httpsLink(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error()
  } catch { throw new Error('链接必须是有效的 HTTPS 地址') }
}

export function validateMenu(value) {
  const { menu } = parseTransferDocument({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION, menu: value, panels: [] })
  const switches = new Set()
  for (const item of menu.items) {
    required(item.name, '菜单名称')
    if (item.type === 'switch') {
      required(item.switchConfig.switchId, '开关标识')
      if (switches.has(item.switchConfig.switchId)) throw new Error('开关标识不能重复')
      switches.add(item.switchConfig.switchId)
    }
    if (item.type === 'menu' && !item.subMenuItems.length) throw new Error('子菜单不能为空')
    for (const entry of item.type === 'menu' ? item.subMenuItems : [item]) {
      required(entry.name, '菜单名称')
      if (entry.type === 'link') httpsLink(entry.link)
      if (entry.type === 'send_message') required(entry.sendMessage, '发送内容')
    }
  }
  return menu
}

export function validatePanel(value) {
  const { panels } = parseTransferDocument({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION, menu: null,
    panels: [{ scope: 'c2c', targetType: 'all', panel: value }] })
  for (const item of panels[0].panel.items) {
    required(item.name, '指令名称')
    if (item.type === 'link') httpsLink(item.link)
  }
  return panels[0].panel
}

export function validateIds(value, label) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label}每次最多 20 项`)
  for (const id of value) {
    if (typeof id !== 'string' || !id.trim() || id.length > 256) throw new Error(`${label}包含无效的 OpenID`)
  }
  return [...new Set(value.map(id => id.trim()))]
}

export function validateCreate(body) {
  const scope = validateScope(body.scope)
  const targetType = body.targetType || 'all'
  if (!['all', 'specific'].includes(targetType)) throw new Error('不支持的作用范围')
  const userOpenIds = validateIds(body.userOpenIds, '用户关联对象')
  const groupOpenIds = validateIds(body.groupOpenIds, '群关联对象')
  if (targetType === 'specific') {
    if (!['c2c', 'group'].includes(scope)) throw new Error('该场景仅支持全局面板')
    if (scope === 'c2c' ? !userOpenIds.length || groupOpenIds.length : !groupOpenIds.length || userOpenIds.length) {
      throw new Error('请填写与生效场景匹配的关联对象')
    }
  } else if (userOpenIds.length || groupOpenIds.length) throw new Error('全局面板不能包含关联对象')
  return { scope, targetType, userOpenIds, groupOpenIds, panel: validatePanel(body.panel) }
}
