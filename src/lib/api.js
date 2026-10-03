let csrf = ''

export function setCsrf(value) { csrf = value || '' }

export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Panel-CSRF': csrf, ...options.headers }
  })
  const payload = await response.json().catch(() => null)
  if (response.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('session-expired'))
  if (!response.ok || payload?.status !== 200) throw new Error(payload?.message || `请求失败（HTTP ${response.status}）`)
  return payload.data
}
