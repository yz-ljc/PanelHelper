<template>
  <div v-if="open" class="bot-sidebar-backdrop" @click="$emit('update:open', false)" />
  <aside class="bot-sidebar" :class="{ 'is-open': open }" aria-label="机器人信息">
    <header><span>指令面板设置</span><button type="button" class="sidebar-close" aria-label="关闭机器人信息" @click="$emit('update:open', false)">×</button></header>
    <div class="bot-identity"><img :src="avatar" alt="机器人头像" referrerpolicy="no-referrer" @error="avatarFailed = true" /><h1>{{ bot.name }}</h1><span class="bot-connected"><i />已连接</span></div>
    <dl><dt>AppID</dt><dd>{{ bot.appId }}</dd><dt>机器人 OpenID</dt><dd>{{ bot.openId || '未提供' }}</dd></dl>
    <p v-if="bot.description" class="bot-description">{{ bot.description }}</p>
    <a v-if="shareUrl" class="bot-share" :href="shareUrl" target="_blank" rel="noopener noreferrer">打开机器人主页 ↗</a>
    <div class="bot-sidebar-foot"><p>会话仅存于本地内存</p><button type="button" @click="$emit('logout')">退出登录</button></div>
  </aside>
</template>
<script setup>
import { computed, ref, watch } from 'vue'
import botIcon from '../assets/bot-blue.svg'
import { botAvatarUrl } from '../lib/botAvatar.js'
const props = defineProps({ bot: { type: Object, required: true }, open: Boolean })
defineEmits(['update:open', 'logout'])
const avatarFailed = ref(false)
const avatarUrl = computed(() => botAvatarUrl(props.bot))
const avatar = computed(() => !avatarFailed.value && avatarUrl.value ? avatarUrl.value : botIcon)
watch(avatarUrl, () => { avatarFailed.value = false })
const shareUrl = computed(() => {
  try { const url = new URL(props.bot.shareUrl); return url.protocol === 'https:' ? url.href : '' } catch { return '' }
})
</script>
