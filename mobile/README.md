# Sherlly Mobile

这是 Sherlly Assistant 的 Expo / React Native 手机端。首版重点解决两个手机工作流问题：

- 任务可以直接写入 iOS / Android 系统日历，不再依赖 `.ics` 文件导入。
- 任务提醒由 native local notification 调度，App 进入后台或浏览器页面不存在时仍由系统负责展示。

## 配置

复制 `.env.example` 为 `.env`，将 `EXPO_PUBLIC_API_URL` 设置为 Cloudflare Worker 的 HTTPS 地址。

```powershell
cd mobile
pnpm install
pnpm start
```

## 调试

Expo Go 可以用于基础界面和 API 联调。Calendar、Notifications 等原生能力建议使用 development build 验证：

```powershell
pnpm exec expo run:android
pnpm exec expo run:ios
```

首次使用时，系统会分别询问通知和日历权限。用户拒绝权限后，需要在系统设置中重新开启。

## 提醒规则

- 只有未完成任务会调度提醒。
- 只有 `dueAt` 的任务会按优先级在截止时间前提醒一次。
- 设置了提醒窗口的任务，会按优先级间隔在窗口内重复提醒，首版最多调度 48 条。
- 编辑或完成任务时，移动端会先取消旧的同任务提醒，再重新调度。

本地提醒只知道手机最近一次同步到的数据。如果电脑端新建任务后手机 App 从未启动过，首版不会主动推送；这需要后续加入 Expo Push Token、Cloudflare Alarm 和远程推送服务。
