# Sherlly 后台线上部署

这个项目的前端可以继续作为 Electron exe 使用；线上只需要部署 `server/index.cjs` 这个 Node/Express 后台。

## 推荐平台

- Render / Railway / Fly.io / 自己的云服务器都可以直接运行当前后台。
- Cloudflare Workers 已提供独立实现：`cloudflare/worker.js` 使用 Cloudflare KV 保存同步数据，并兼容现有 `/health`、`/ready`、`/api/data` 接口。

## 必填环境变量

```env
PORT=8787
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/sherlly?retryWrites=true&w=majority
MONGODB_DB=sherlly
MONGODB_COLLECTION=appData
SHERLLY_USER_ID=default
SHERLLY_API_TOKEN=<一段足够长的随机字符串>
CORS_ORIGIN=*
```

`SHERLLY_API_TOKEN` 配置后，所有 `/api/*` 请求都必须带 `Authorization: Bearer <token>`。

## Render 部署

仓库里已经提供 `render.yaml`。

1. 在 Render 新建 Blueprint 或 Web Service。
2. Build Command 使用 `npm ci --omit=dev`。
3. Start Command 使用 `npm run start`。
4. Health Check Path 使用 `/health`。
5. 在 Render 环境变量里配置 `MONGODB_URI` 和 `SHERLLY_API_TOKEN`。
6. 部署成功后访问 `https://你的服务域名/health`，看到 `{ "ok": true }` 即后台可访问。
7. 访问 `https://你的服务域名/ready`，确认 MongoDB 连通。

## Docker 部署

```bash
docker build -t sherlly-server .
docker run -p 8787:8787 --env-file .env sherlly-server
```

## Cloudflare Workers 部署

Cloudflare 版本不使用 MongoDB；它通过 KV 命名空间 `SHERLLY_DATA` 保存应用数据。

1. 安装依赖：

```bash
npm install
```

2. 登录 Cloudflare：

```bash
npx wrangler login
```

3. 创建生产 KV 命名空间：

```bash
npm run cf:kv:create
```

把命令输出里的 `id` 填到 `wrangler.jsonc` 的 `kv_namespaces[0].id`。

4. 创建预览 KV 命名空间：

```bash
npx wrangler kv namespace create SHERLLY_DATA --preview
```

把命令输出里的 `preview_id` 填到 `wrangler.jsonc` 的 `kv_namespaces[0].preview_id`。

5. 写入后台访问 token：

```bash
npm run cf:secret:token
```

6. 部署 Worker：

```bash
npm run cf:deploy
```

7. 部署成功后检查：

```bash
curl https://你的-worker域名/health
curl https://你的-worker域名/ready
curl -H "Authorization: Bearer <token>" "https://你的-worker域名/api/data?userId=default"
```

## exe 连接线上后台

构建 exe 前，把前端环境变量指到线上后台：

```env
VITE_SHERLLY_API_URL=https://你的服务域名
VITE_SHERLLY_USER_ID=default
VITE_SHERLLY_API_TOKEN=<和后台一致的 token>
```

开发时也可以先在本机 `.env` 里这样配置，然后启动桌面端验证。

## API 检查

```bash
curl https://你的服务域名/health
curl https://你的服务域名/ready
curl -H "Authorization: Bearer <token>" "https://你的服务域名/api/data?userId=default"
```
