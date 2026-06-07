# Sherlly Token 更换与重新部署流程

本文记录 `SHERLLY_API_TOKEN` / `VITE_SHERLLY_API_TOKEN` 的来源、修改位置、重新部署方式和 Git 提交规则。

## 这两个 token 是什么

`SHERLLY_API_TOKEN` 是后台访问门禁，后台会用它校验 `/api` 请求。

`VITE_SHERLLY_API_TOKEN` 是前端构建时读取的同一个门禁 token，前端请求后台时会把它放到 `X-Sherlly-Token` 请求头里。

两者必须填写同一个值。否则前端请求后台会返回 `401 未授权`。

## 为什么要这样做

后台的 `SHERLLY_API_TOKEN` 负责判断请求是否来自被允许的前端或客户端。

登录后产生的 `Authorization: Bearer <login-token>` 是用户会话 token，用来识别具体账号。它和 `SHERLLY_API_TOKEN` 不是同一种东西。

把后台门禁 token 和用户登录 token 分开，是好主意，因为它让“谁能访问后台接口”和“当前登录的是哪个用户”分成两层校验，排查问题也更清楚。

## 什么时候需要更换

出现以下情况时，应该更换 token：

- token 被粘贴到聊天、截图、日志或公开页面里。
- 怀疑 `.env`、Cloudflare Secret、GitHub Secret 泄露。
- 准备重新整理线上和本地配置，避免旧值混乱。

## 生成新 token

在项目根目录执行：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

复制输出的新字符串。不要把它提交到 Git，也不要贴到公开位置。

## 修改本地 `.env`

把两行改成同一个新值：

```env
SHERLLY_API_TOKEN=<新的长随机token>
VITE_SHERLLY_API_TOKEN=<新的长随机token>
```

本地 `.env` 已经在 `.gitignore` 中，正常情况下不需要也不应该提交。

修改后重启本地服务，让 Node 和 Vite 重新读取环境变量：

```powershell
npm run server
npm run dev
```

如果使用桌面端开发：

```powershell
npm run desktop
```

## 修改 Cloudflare Worker Secret

如果后台部署在 Cloudflare Workers，需要更新 Worker 的 `SHERLLY_API_TOKEN`。

推荐直接执行：

```powershell
npx wrangler secret put SHERLLY_API_TOKEN
```

也可以使用项目脚本：

```powershell
npm run cf:secret:token
```

Wrangler 提示输入 secret 时，粘贴新 token 并回车。输入过程可能不显示字符，这是正常现象。

如果命令交互报错，可以到 Cloudflare 控制台修改：

```text
Cloudflare Dashboard
Workers & Pages
sherlly-server
Settings
Variables and Secrets
SHERLLY_API_TOKEN
Edit / Update
```

## 修改前端部署环境变量

如果前端部署在 Cloudflare Pages、GitHub Pages、Vercel、Netlify 或 GitHub Actions，需要同步更新前端环境变量：

```env
VITE_SHERLLY_API_TOKEN=<同一个新token>
```

前端环境变量会在构建时写入前端产物，所以只改变量还不够，必须重新部署前端。

## 重新部署

部署 Cloudflare Worker 后台：

```powershell
npm run cf:deploy
```

重新部署 Cloudflare Pages 前端：

```text
Cloudflare Dashboard
Workers & Pages
你的 Pages 项目
Deployments
Retry deployment / Redeploy
```

如果前端通过 GitHub Actions 部署，重新运行前端部署 workflow。

## 验证

先检查后台基础接口：

```powershell
curl.exe https://你的-worker域名/health
curl.exe https://你的-worker域名/ready
```

再用新 token 检查 `/api` 访问：

```powershell
curl.exe -X POST -H "Content-Type: application/json" -H "X-Sherlly-Token: <新token>" -d "{\"username\":\"demo@example.com\",\"password\":\"secret123\"}" "https://你的-worker域名/api/auth/login"
```

如果 token 不一致，通常会看到 `401` 和类似 `未授权：缺少或错误的 SHERLLY_API_TOKEN` 的返回。

## Git 提交规则

不要提交 `.env`。

可以提交的只有文档、代码和模板配置，例如：

```text
docs/token-rotation.md
.env.example
wrangler.jsonc
```

如果只是更换真实 token，不需要创建 Git commit。真实 token 应该只存在于本地 `.env`、Cloudflare Secret、前端部署平台环境变量或 GitHub Secret 中。
