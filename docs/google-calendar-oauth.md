# Google Calendar OAuth

当前实现是只读连接：用户授权后，Sherlly 只读取指定时间窗口内的会议预览，不创建、修改或删除 Google Calendar 事件，也不会自动把会议变成任务。

## Google Cloud Console

1. 创建或选择一个 Google Cloud project。
2. 启用 Google Calendar API。
3. 配置 OAuth consent screen，只申请 Calendar API 的只读 scope。
4. 创建 Web application 类型的 OAuth client。
5. 把以下 callback URL 添加到 Authorized redirect URIs：

```text
https://<worker-domain>/api/integrations/google/callback
```

本地 Wrangler 开发时可以使用：

```text
http://127.0.0.1:8787/api/integrations/google/callback
```

实现使用的官方 scope：

```text
https://www.googleapis.com/auth/calendar.readonly
```

参考官方文档：

- OAuth Web Server flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Calendar events.list: https://developers.google.com/calendar/api/v3/reference/events/list

## Worker 配置

公开配置通过 `wrangler.jsonc` 的 `vars` 或环境变量设置：

```text
GOOGLE_OAUTH_CLIENT_ID=<client-id>
GOOGLE_OAUTH_REDIRECT_URI=https://<worker-domain>/api/integrations/google/callback
GOOGLE_OAUTH_SUCCESS_URL=https://<frontend-domain>/
```

敏感值只能通过 Wrangler Secret 设置：

```powershell
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
npx wrangler secret put GOOGLE_OAUTH_STATE_SECRET
npx wrangler secret put GOOGLE_OAUTH_TOKEN_KEY
```

三个 Secret 的用途不同：

- `GOOGLE_OAUTH_CLIENT_SECRET`：和 Google token endpoint 交换 authorization code。
- `GOOGLE_OAUTH_STATE_SECRET`：签名 OAuth state，绑定用户、一次性 state 和过期时间。
- `GOOGLE_OAUTH_TOKEN_KEY`：派生 AES-GCM 密钥，加密 Durable Object 中的 refresh token。

不要把这些值写入前端 `.env`、`settings`、任务数据、导出文件或日志。

## Flow

1. 已登录用户从“外部连接”页面确认 `calendar.readonly` 范围。
2. 前端请求 `/api/integrations/google/start`，Worker 生成 state 和 PKCE verifier。
3. Worker 将 verifier 保存到用户 Durable Object，并返回 Google authorization URL。
4. Google 回调 Worker；Worker 验证 state、消费一次性 verifier，并在服务端交换 token。
5. refresh token 以密文保存，access token 只在 Worker 内短暂使用。
6. `/api/integrations/google/events` 默认读取未来 7 天，最长允许 31 天。
7. 返回给前端的会议只包含 ID、标题、开始/结束时间、全天标记和状态，不包含描述、地点或其他扩展字段。
8. “断开连接”会删除服务端 refresh token；它不会修改 Google Calendar 中的任何事件。

真实账号联调前，必须在目标 Cloudflare 环境完成 OAuth client、callback URL 和三项 Secret 配置。当前仓库只做局部/mock 验证，不自动部署生产配置。
