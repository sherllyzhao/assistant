# Sherlly 后台线上部署

这个项目的前端可以继续作为 Electron exe 使用；线上只需要部署 `server/index.cjs` 这个 Node/Express 后台。

## 推荐平台

- Render / Railway / Fly.io / 自己的云服务器都可以直接运行当前后台。
- Cloudflare Workers 已提供独立实现：`cloudflare/worker.js` 使用 Cloudflare KV 保存账号、登录会话和同步数据，并兼容 `/health`、`/ready`、`/api/auth/*`、`/api/data` 接口。

## 必填环境变量

```env
PORT=8787
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/sherlly?retryWrites=true&w=majority
MONGODB_DB=sherlly
MONGODB_COLLECTION=appData
MONGODB_USERS_COLLECTION=users
MONGODB_SESSIONS_COLLECTION=sessions
SHERLLY_SESSION_TTL_DAYS=30
SHERLLY_API_TOKEN=<一段足够长的随机字符串>
CORS_ORIGIN=*
```

`SHERLLY_API_TOKEN` 是后台访问门禁；前端会用 `X-Sherlly-Token` 发送它。账号登录成功后，用户会话 token 使用 `Authorization: Bearer <login-token>` 发送，数据归属于该登录账号。

## Render 部署

仓库里已经提供 `render.yaml`。

1. 在 Render 新建 Blueprint 或 Web Service。
2. Build Command 使用 `npm ci --omit=dev`。
3. Start Command 使用 `npm run start`。
4. Health Check Path 使用 `/health`。
5. 在 Render 环境变量里配置 `MONGODB_URI` 和 `SHERLLY_API_TOKEN`。
6. 部署成功后访问 `https://你的服务域名/health`，看到 `{ "ok": true }` 即后台可访问。
7. 访问 `https://你的服务域名/ready`，确认 MongoDB 连通。
8. 前端第一次连接线上后台时，在应用内注册账号；之后换电脑登录同一账号即可同步同一份数据。

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
curl -X POST -H "Content-Type: application/json" -H "X-Sherlly-Token: <后台token>" \
  -d "{\"username\":\"demo@example.com\",\"password\":\"secret123\"}" \
  "https://你的-worker域名/api/auth/register"
```

## exe 连接线上后台

构建 exe 前，把前端环境变量指到线上后台：

```env
VITE_SHERLLY_API_URL=https://你的服务域名
VITE_SHERLLY_API_TOKEN=<和后台一致的 token>
```

开发时也可以先在本机 `.env` 里这样配置，然后启动桌面端验证。

## exe 加载线上页面

如果希望“页面改了不用重新发 exe”，就把桌面端做成稳定外壳：

1. 把前端 `dist` 部署到 Cloudflare Pages / Vercel / Netlify / GitHub Pages 等静态托管平台。
2. 在这个前端部署环境里配置：

```env
VITE_SHERLLY_API_URL=https://你的后台服务域名
VITE_SHERLLY_API_TOKEN=<和后台一致的 token>
```

3. 打包 exe 前配置：

```env
SHERLLY_RENDERER_URL=https://你的前端页面域名
```

4. 执行：

```bash
npm run renderer:config
npm run pack:win
```

生成的 exe 会优先加载 `SHERLLY_RENDERER_URL`。之后只要前端页面仍部署在同一个 URL，修改页面后只需要重新部署 Web 前端，不需要重新发布 exe。远程页面不可访问时，exe 会回退到安装包内置的 `dist/index.html`。

## GitHub Releases 自动发布安装包

仓库已提供 `.github/workflows/release-desktop.yml`。它会监听 `main` / `master` 分支上的 `package.json` 改动；只有 `version` 字段发生变化时，才会按这个版本自动发布安装包。

第一次使用前，在 GitHub 仓库配置：

- Repository variable `SHERLLY_RENDERER_URL`：线上前端页面地址。
- Repository variable `VITE_SHERLLY_API_URL`：线上后台 API 地址，用作安装包内置页面的回退配置。
- Repository secret `VITE_SHERLLY_API_TOKEN`：和后台 `SHERLLY_API_TOKEN` 一致。

发布步骤示例：

```bash
npm version patch --no-git-tag-version
git add package.json
git commit -m "chore: release 0.1.1"
git push
```

GitHub Actions 会读取 `package.json` 里的版本号，先在 runner 里临时同步 `package-lock.json`，再自动创建或复用 `v版本号` tag，安装依赖、写入桌面端远程页面配置、运行目标检查、构建前端和 Windows 安装包，然后上传到对应 GitHub Release。如果版本号没变且对应 tag 已存在，发布会被跳过；如果上一次发包失败导致 tag 不存在，推送 lockfile 或 workflow 修复后会补发当前版本。

## API 检查

```bash
curl https://你的服务域名/health
curl https://你的服务域名/ready
curl -X POST -H "Content-Type: application/json" -H "X-Sherlly-Token: <后台token>" \
  -d "{\"username\":\"demo@example.com\",\"password\":\"secret123\"}" \
  "https://你的服务域名/api/auth/login"
```
