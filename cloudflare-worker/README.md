# TalkTunnel Discovery Worker

This Worker stores TalkTunnel desktop clients in D1, serves the mobile page at `/{uuid}`, and queues text/Enter actions when LAN delivery fails. The desktop polls the queue, acknowledges processed actions, and the Worker clears their text. Files remain LAN-only.

## Setup

1. Create a D1 database:
   ```sh
   npx wrangler d1 create talktunnel-discovery
   ```
2. Put the returned `database_id` into `wrangler.jsonc`.
3. Apply schema:
   ```sh
   npm run db:migrate
   ```
4. Deploy:
   ```sh
   npm run deploy
   ```
5. Set `/Users/nexusone/project/talktunnel/config/cloudflare.json` to your Worker custom domain.

Browser limit: a HTTPS Worker page may be blocked from calling `http://192.168.x.x` or `ws://192.168.x.x` by mixed-content policy. If that happens in your target browser, the desktop LAN server must also run HTTPS/WSS with a trusted local certificate, or you need a Cloudflare Tunnel/proxy path instead of direct LAN HTTP.
