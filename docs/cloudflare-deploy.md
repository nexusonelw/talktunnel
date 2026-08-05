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

手机扫码后输入同一个设备密码，再由网页尝试直连桌面端局域网 IP。

## 重要限制

Cloudflare Worker 页面是 HTTPS，而桌面端当前局域网服务是 HTTP/WS。部分浏览器会拦截 HTTPS 页面访问 `http://192.168.x.x` 或 `ws://192.168.x.x`，这是 Mixed Content 限制，不是 CORS 能完全解决的问题。

如果测试时手机页面认证成功但无法直连桌面端，需要后续把桌面端局域网服务升级为 HTTPS/WSS，或改成 Cloudflare Tunnel/代理链路。
