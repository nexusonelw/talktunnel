# TalkTunnel Agent Context

## 目标

TalkTunnel 是一个 Electron 桌面端 + Cloudflare Worker 移动端的跨设备文本/文件传输工具。后续 AI 接手时不要重新初始化需求，直接按本文理解当前架构、部署方式、认证方式和关键约束。

## 当前架构

桌面端：
- Electron 主应用入口：`main.js`
- 本地 Express/WS 服务：`server.js`
- 桌面窗口二维码渲染：`renderer.js`
- Cloudflare 注册/同步模块：`cloudSyncService.js`
- 本机网卡 IP 轮询模块：`networkMonitor.js`
- Cloudflare 域名配置：`config/cloudflare.json`

移动端：
- 由 Cloudflare Worker 托管，不再由本地 Express 托管。
- Worker 目录：`cloudflare-worker/`
- Worker 主文件：`cloudflare-worker/src/index.js`
- D1 migrations：`cloudflare-worker/migrations/0001_clients.sql`、`cloudflare-worker/migrations/0002_relay_messages.sql`
- 移动端页面由 Worker 直接返回 HTML 字符串。

发现层：
- 二维码必须是 Cloudflare 域名 + UUID：
  `https://talktunnel.onlinesoftware.top/<UUID>`
- 禁止回退到本机 IP 二维码。
- 如果 Electron 未拿到 UUID，桌面二维码区域显示 Cloudflare 注册错误，不生成局域网二维码。

## Cloudflare 配置

桌面端配置文件：

```json
{
  "workerBaseUrl": "https://talktunnel.onlinesoftware.top"
}
```

路径：

```text
config/cloudflare.json
```

打包时通过 `package.json -> build.extraResources` 带入安装包。

Worker 默认地址：

```text
https://talktunnel-discovery.nexusone.workers.dev
```

自定义域名：

```text
https://talktunnel.onlinesoftware.top
```

## D1 数据库

数据库名：

```text
talktunnel-discovery
```

database_id：

```text
4f64d3bb-af57-4aa3-ac15-5663c0d95f59
```

Wrangler binding：

```text
env.DB
```

Schema：

```sql
CREATE TABLE IF NOT EXISTS clients (
  uuid TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  registration_secret_hash TEXT NOT NULL,
  lan_ips TEXT NOT NULL,
  port INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 认证和注册流程

桌面端首次启动：
1. `main.js` 等桌面页面 `did-finish-load` 后启动 `startServer()`。
2. `cloudSync.ensureRegistered()` 检查本地 `electron-store` 是否已有：
   - `cloudClient.uuid`
   - `cloudClient.registrationSecret`
3. 如果没有，桌面页面弹出初始化密码输入层。
4. Electron 收集本机局域网 IP 和本地服务端口。
5. POST 到 Worker：
   `POST /api/register`
6. Worker 生成 UUID、salt、registrationSecret。
7. Worker 使用 PBKDF2-SHA256 保存：
   - `password_hash`
   - `registration_secret_hash`
8. 桌面端在本地 `electron-store` 保存 UUID、registrationSecret 和可在设置界面查看的访问密码；D1 只保存密码哈希。

桌面端后续启动：
1. 使用本地 UUID + registrationSecret。
2. POST `/api/update-ips` 更新最新 `lanIps + port`。

扫码连接：
1. 移动端打开 `/{uuid}`。
2. 移动端每次访问都在页面中输入访问密码，不从浏览器缓存读取密码。
3. POST `/api/auth` 校验 password 并拉取 `lanIps + port`。
4. 密码和设备地址只保留在当前页面内存中。

## IP 策略

桌面端收集 IPv4：
- `192.*`
- `100.*`
- `10.*`

排序优先级：

```text
192.* -> 100.* -> 10.*
```

移动端发送策略：
1. 页面认证后获取设备局域网地址；文本和回车先向桌面 Express 直接发送。
2. 局域网发送失败时，POST `/api/client` 更新一次 IP+端口并重试。
3. 仍失败时，POST `/api/relay/submit` 把文本操作加入 D1 队列，并在页面提示切换云端。
4. 桌面端每 5 秒用注册凭证调用 `/api/relay/poll`，执行后调用 `/api/relay/ack`；网页用 `/api/relay/status` 查看结果。
5. 局域网和云端请求使用相同操作 ID，桌面端通过持久化执行记录避免常见的超时重复执行。
6. 文件传输仍只走局域网；云端队列不接收文件。

云端兜底会使文本暂存于 Cloudflare D1，处理成功后正文清空；消息在 24 小时后过期，并由每小时运行的定时任务清理。

## 关键接口

Worker：
- `POST /api/register`
- `POST /api/update-ips`
- `POST /api/auth`
- `POST /api/client`
- `POST /api/relay/submit`
- `POST /api/relay/status`
- `POST /api/relay/poll`
- `POST /api/relay/ack`
- `GET /manifest.webmanifest?uuid=<UUID>`
- `GET /sw`
- `GET /pwa-icon.svg`
- `GET /<UUID>`

桌面 Express：
- `POST /`：接收文本并粘贴到桌面焦点处。
- `POST /connect`：移动端连接登记；成功后桌面端重新上报当前 IP+端口到 Cloudflare。
- `POST /heartbeat`
- `GET /get-delay`
- `POST /save-delay`
- `POST /enter-key`
- `POST /send-and-enter`
- `POST /upload-to-pc`
- `POST /send-to-phones`

## PWA

Worker 移动页已实现 PWA：
- manifest：`/manifest.webmanifest?uuid=<UUID>`
- service worker：`/sw`
- icon：`/pwa-icon.svg`
- 页面监听 `beforeinstallprompt`
- 页面底部提供“安装 TalkTunnel”按钮
- iOS 无原生 install prompt 时提示“添加到主屏幕”

浏览器是否弹原生安装框由浏览器控制，代码不能绕过浏览器策略强制弹出。

## Mixed Content 限制

移动端页面来自 HTTPS Cloudflare，但桌面端局域网服务是 HTTP/WS。

部分浏览器可能拦截：

```text
https://talktunnel.onlinesoftware.top -> http://192.168.x.x:<port>
```

这是浏览器 Mixed Content 策略，不是 CORS 能完全解决。当前代码只在真正发送失败时提示网络错误，初始化连接登记失败不再弹旧的 HTTPS/HTTP 误报。

## 本地运行

根目录：

```bash
cd /Users/nexusone/project/talktunnel
npm install
npm start
```

如果安装残留导致异常：

```bash
rm -rf node_modules
npm install
npm start
```

注意：旧的 `electron-icon-maker` 已删除，避免拉取 `phantomjs-prebuilt`。

## Cloudflare 部署

```bash
cd /Users/nexusone/project/talktunnel/cloudflare-worker
npm install
npx wrangler login
npx wrangler d1 migrations apply talktunnel-discovery --remote
npx wrangler deploy
```

验证：

```bash
curl https://talktunnel.onlinesoftware.top/sw
curl 'https://talktunnel.onlinesoftware.top/manifest.webmanifest?uuid=00000000-0000-4000-8000-000000000000'
```

## Mac 构建和发布

当前版本号在根 `package.json` 中维护。

构建 mac 安装包时不要跑 `npm run generate-icons`，因为当前 PATH 中没有 `electron-icon-builder`，而现有图标文件已经在 `build/icons/`。

构建：

```bash
cd /Users/nexusone/project/talktunnel
npx electron-builder --mac --arm64 --publish=never
```

如果 macOS `hdiutil` 在 DMG 收尾失败，通常 arm64 DMG 已经生成；可再补一次：

```bash
npx electron-builder --mac --x64 --publish=never
```

上传 GitHub Release 资产但不推代码：

```bash
gh release create 1.0.1 dist/TalkTunnel-1.0.1-arm64.dmg dist/TalkTunnel-1.0.1.dmg --title "TalkTunnel 1.0.1" --notes "..."
```

或覆盖已有资产：

```bash
gh release upload 1.0.1 dist/TalkTunnel-1.0.1-arm64.dmg dist/TalkTunnel-1.0.1.dmg --clobber
```

不要执行 `git push`，除非用户明确要求上传代码。

## 当前 GitHub Release

Release：

```text
https://github.com/nexusonelw/talktunnel/releases/tag/1.0.1
```

安装包：

```text
https://github.com/nexusonelw/talktunnel/releases/download/1.0.1/TalkTunnel-1.0.1-arm64.dmg
https://github.com/nexusonelw/talktunnel/releases/download/1.0.1/TalkTunnel-1.0.1.dmg
```

## 后续开发规则

- 不要把 Cloudflare 逻辑继续堆进 `server.js`；使用 `cloudSyncService.js`。
- 不要恢复本机 IP 二维码回退。
- 文本和回车优先使用局域网；局域网失败后才刷新一次云端 IP，仍失败时使用云端文本队列。
- 文件仍不得进入 Cloudflare 文本队列。
- 保持 Worker 子项目独立在 `cloudflare-worker/`。
- 构建/发布安装包可以上传 GitHub Release 资产，但不要推源码，除非用户明确要求。
