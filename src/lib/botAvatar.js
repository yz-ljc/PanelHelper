export function botAvatarUrl(bot) {
  const appId = String(bot.appId || '').trim()
  const openId = String(bot.openId || '').trim()
  return appId && openId
    ? `https://thirdqq.qlogo.cn/qqapp/${encodeURIComponent(appId)}/${encodeURIComponent(openId)}/100`
    : ''
}
