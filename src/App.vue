<template>
  <div v-if="checking" class="session-loading" role="status">正在检查本地会话…</div>
  <MenuPanelView v-else-if="bot" :bot="bot" @logout="logout" />
  <main v-else class="login-page">
    <section class="login-card">
      <div class="login-brand"><img :src="botIcon" alt="" /><span>指令面板设置</span></div>
      <h1>连接 QQ 机器人</h1>
      <p class="login-description">在本地管理自定义菜单与指令面板。</p>
      <form @submit.prevent="login" :aria-busy="submitting">
        <label>AppID<input v-model.trim="appId" name="appid" inputmode="numeric" autocomplete="username" required maxlength="32" :disabled="submitting" placeholder="机器人 AppID" /></label>
        <label>AppSecret<input v-model="secret" name="secret" type="password" autocomplete="off" required maxlength="256" :disabled="submitting" placeholder="机器人 AppSecret" /></label>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button class="login-submit" :disabled="submitting">{{ submitting ? '正在连接…' : '连接机器人' }}</button>
      </form>
      <p class="login-note">凭据仅保存在本地进程内存中，退出登录或关闭工具后清除。登录及同步配置需要连接 QQ 官方接口。</p>
    </section>
    <p class="login-footer">本地部署 · 无需 AtriMeow 服务 · 无第三方中转</p>
  </main>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import MenuPanelView from './views/MenuPanelView.vue'
import { api, setCsrf } from './lib/api.js'
import botIcon from './assets/bot-blue.svg'

const bot = ref(null)
const appId = ref('')
const secret = ref('')
const error = ref('')
const submitting = ref(false)
const checking = ref(true)
function acceptSession(session) { bot.value = session.bot; setCsrf(session.csrf) }
function expire() { bot.value = null; secret.value = ''; setCsrf('') }
async function login() {
  if (submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    acceptSession(await api('/auth/login', { method: 'POST', body: JSON.stringify({ appId: appId.value, secret: secret.value }) }))
  } catch (cause) {
    error.value = cause.message
  } finally {
    secret.value = ''
    submitting.value = false
  }
}
async function logout() {
  try { await api('/auth/logout', { method: 'POST' }); expire() }
  catch (cause) { window.alert(cause.message) }
}
onMounted(async () => {
  window.addEventListener('session-expired', expire)
  try { acceptSession(await api('/session')) } catch { expire() }
  finally { checking.value = false }
})
onBeforeUnmount(() => window.removeEventListener('session-expired', expire))
</script>
