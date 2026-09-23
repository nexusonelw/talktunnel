# TalkTunnel Cloudflare 部署与本地运行

## Cloudflare D1 与 Worker 部署

进入 Worker 子项目：

```bash
cd /Users/nexusone/project/talktunnel/cloudflare-worker
```

首次登录 Cloudflare：

```bash
npx wrangler login
```

创建 D1 数据库：

```bash
npx wrangler d1 create talktunnel-discovery
```

把输出里的 `database_id` 写入：

```text
/Users/nexusone/project/talktunnel/cloudflare-worker/wrangler.jsonc
```

当前项目已配置为：

```json
"database_id": "4f64d3bb-af57-4aa3-ac15-5663c0d95f59"
```

执行 D1 远程迁移：

```bash
npx wrangler d1 migrations apply talktunnel-discovery --remote
```

部署 Worker：

```bash
npx wrangler deploy
```

桌面端使用的 Worker 域名配置在：

```text
/Users/nexusone/project/talktunnel/config/cloudflare.json
```

当前值：

```json
{
  "workerBaseUrl": "https://talktunnel.onlinesoftware.top"
}
```

## 本地启动桌面客户端

进入项目根目录：

```bash
cd /Users/nexusone/project/talktunnel
```

安装依赖：

```bash
npm install
```

如果之前安装失败并出现 `phantomjs-prebuilt`，先清理半截安装目录后重装：

```bash
rm -rf node_modules
npm install
```

当前项目已移除旧的 `electron-icon-maker` 依赖；它会间接拉取 `svg2png -> phantomjs-prebuilt`，本地启动不需要这条旧图标生成链路。

启动 Electron 客户端：

```bash
npm start
```

首次启动时，如果 `config/cloudflare.json` 是真实 Worker 域名，客户端会弹窗要求设置设备密码。注册成功后二维码会变成：

```text
https://talktunnel.onlinesoftware.top/<UUID>
```

手机扫码后输入同一个设备密码。验证成功后，密码默认保存在该浏览器的本地存储中；以后打开页面会自动验证，再尝试直连桌面端局域网 IP。页面底部的“清空保存的密码”会删除本地密码并退出当前连接。

文本和“发送后回车”优先走局域网。局域网发送失败时，网页会更新一次设备地址并重试；仍失败则把文本操作提交到 Worker 的 D1 队列。桌面客户端每 5 秒领取并处理队列，处理成功后 Worker 清空正文。消息 24 小时后过期，由每小时运行的定时任务清理；单条文本最多 64 KiB。文件传输仍只走局域网。云端兜底会使文本短暂经过并保存在 Cloudflare D1，请不要将其视为端到端加密传输。升级时须先执行 `0002_relay_messages.sql` 远程迁移，再部署 Worker，并更新桌面客户端。

桌面客户端右上角的钥匙按钮可查看和修改访问密码。首次注册后密码会保存在本机的 Electron 配置中，方便查看；Cloudflare D1 只保存加盐哈希。升级前已注册的设备无法从哈希恢复旧密码，设置一个新密码即可覆盖。手机浏览器保存的是明文密码，只适合本人信任的设备；密码修改后旧密码会在下次验证时失效并从该浏览器移除。

## 重要限制

Cloudflare Worker 页面是 HTTPS，而桌面端当前局域网服务是 HTTP/WS。部分浏览器会拦截 HTTPS 页面访问 `http://192.168.x.x` 或 `ws://192.168.x.x`，这是 Mixed Content 限制，不是 CORS 能完全解决的问题。

如果浏览器拦截局域网 HTTP，文本和回车会自动使用云端兜底；文件与桌面到手机的 WebSocket 传输仍需可用的局域网连接。
