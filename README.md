# 指令面板设置

QQ 机器人自定义菜单与指令面板的本地配置工具。使用机器人的 AppID 和 AppSecret 登录，读取机器人资料并管理 QQ 官方接口中的配置。

界面基于 AtriMeow 的 `MenuPanelView.vue` 提取，保留菜单编辑、手机预览和场景标签设计。侧栏展示当前机器人的基本信息。项目拥有独立的构建、测试和本地服务，不依赖 AtriMeow 后端或数据库。

## 功能

- 自定义菜单：发送消息、HTTPS 链接、开关、折叠子菜单和拖动排序。
- 指令面板：私聊、群聊、频道文字子频道、频道私信四种场景。
- 面板创建、编辑、删除，以及指定用户或群的关联管理。
- 单项 JSON 导入与导出，兼容原有 `atribot-menu-panel` 配置格式。
- 机器人名称、头像、AppID、OpenID 和分享链接展示。
- AppSecret 和访问令牌仅保存在本地服务进程内存中。

## 使用分发包

运行环境：Node.js 22.13.0 或更高版本，支持现代桌面浏览器。启动前可使用 `node --version` 检查版本。

1. 解压 `panel-helper-<版本>.zip`。
2. Windows 双击 `start.cmd`；macOS 或 Linux 执行 `sh start.sh`。
3. 浏览器自动打开 `http://127.0.0.1:4973`。如未自动打开，可手动访问该地址。
4. 输入机器人的 AppID、AppSecret 后登录。
5. 编辑菜单或指令面板，并通过对应保存按钮提交。

分发包包含构建后的网页资源和本地服务，无需执行 `npm install`。页面资源不依赖 CDN；登录、读取和保存配置仍需访问 QQ 官方服务，机器人头像也可能从远程地址加载。“本地分发”不代表可以在断网状态下修改 QQ 配置。

启动终端需要保持运行。使用 `Ctrl+C` 关闭服务；退出登录、会话到期或进程结束后需要重新登录。会话有效期为 8 小时。

默认端口被占用时，可先设置 `PANEL_HELPER_PORT`，再启动服务，例如 PowerShell：

```powershell
$env:PANEL_HELPER_PORT = '4975'
node server/index.mjs --open
```

## 开发

在本项目目录执行：

```sh
npm ci
npm run dev
```

开发模式同样使用 `http://127.0.0.1:4973`。本地 HTTP 服务集成 Vite 中间件，前端与 API 使用同一来源。

```sh
npm test          # 运行本地模拟接口测试，不连接真实机器人
npm run build    # 构建前端
npm start        # 启动构建后的应用
npm run release  # 构建并生成 ZIP 和 SHA-256 校验文件
```

输出位于 `release/`，不包含依赖目录、Git 元数据和测试代码。运行时仅依赖 Node.js 内置模块。

## 文档

- [使用说明](docs/user-guide.md)
- [架构与开发约定](docs/architecture.md)
- [安全说明](SECURITY.md)
- [第三方组件声明](THIRD_PARTY_NOTICES.md)

本项目尚未指定项目许可证。第三方组件的许可证声明独立保留。
