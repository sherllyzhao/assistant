const {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "Sherlly Assistant";
const APP_USER_MODEL_ID = "com.sherlly.assistant";
const UPDATE_REPOSITORY = "sherllyzhao/--";
const DATA_FILE_NAME = "sherlly-data.json";
const RENDERER_CONFIG_FILE_NAME = "renderer-config.json";
const QUICK_CAPTURE_SHORTCUT = "CommandOrControl+Alt+S";
const LOCAL_DEV_RENDERER_URL = "http://127.0.0.1:5188";
const DEV_RENDERER_URL = normalizeRendererUrl(process.env.ELECTRON_RENDERER_URL) || LOCAL_DEV_RENDERER_URL;

let mainWindow = null;
let tray = null;
let trayImages = null;
let trayFlashTimer = null;
let trayFlashTick = 0;
let trayFlashActive = false;
let updateStatus = {
  state: "idle",
  message: "",
};
let updateCheckPromise = null;
let updateDownloadPromise = null;
let pendingInstallAfterDownload = false;

const defaultData = {
  tasks: [],
  candidates: [],
  logs: [],
  settings: {
    soundEnabled: true,
  },
};

function getDataPath() {
  return path.join(app.getPath("userData"), DATA_FILE_NAME);
}

function getDataPaths() {
  const appDataPath = app.getPath("appData");
  const candidatePaths = [
    getDataPath(),
    path.join(appDataPath, APP_NAME, DATA_FILE_NAME),
    path.join(appDataPath, "sherlly-assistant", DATA_FILE_NAME),
    path.join(appDataPath, "Electron", DATA_FILE_NAME),
  ];
  const seenPaths = new Set();

  return candidatePaths.filter((filePath) => {
    const key = path.resolve(filePath).toLowerCase();

    if (seenPaths.has(key)) {
      return false;
    }

    seenPaths.add(key);
    return true;
  });
}

function normalizeData(data) {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
    settings: {
      ...defaultData.settings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
}

function hasMeaningfulData(data) {
  return data.tasks.length > 0 || data.candidates.length > 0 || data.logs.length > 0;
}

function getItemTimestamp(item) {
  return new Date(item?.updatedAt || item?.createdAt || item?.detectedAt || 0).getTime();
}

function mergeItems(currentItems, nextItems) {
  const itemsById = new Map();

  for (const item of currentItems) {
    if (item?.id) {
      itemsById.set(item.id, item);
    }
  }

  for (const item of nextItems) {
    if (!item?.id) {
      continue;
    }

    const existing = itemsById.get(item.id);

    if (!existing || getItemTimestamp(item) >= getItemTimestamp(existing)) {
      itemsById.set(item.id, item);
    }
  }

  return [...itemsById.values()];
}

function mergeData(currentData, nextData) {
  const current = normalizeData(currentData);
  const next = normalizeData(nextData);

  return {
    tasks: mergeItems(current.tasks, next.tasks),
    candidates: mergeItems(current.candidates, next.candidates),
    logs: mergeItems(current.logs, next.logs),
    settings: {
      ...current.settings,
      ...next.settings,
    },
  };
}

function readDataPath(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.error(`Failed to read Sherlly data file at ${filePath}:`, error);
    return null;
  }
}

function readDataFile() {
  let mergedData = defaultData;
  let foundData = false;

  for (const filePath of getDataPaths()) {
    const data = readDataPath(filePath);

    if (!data) {
      continue;
    }

    foundData = true;
    mergedData = mergeData(mergedData, data);
  }

  if (foundData && hasMeaningfulData(mergedData) && !hasMeaningfulData(readDataPath(getDataPath()) || defaultData)) {
    writeDataFile(mergedData);
  }

  return foundData ? mergedData : defaultData;
}

function writeDataFile(data) {
  const filePath = getDataPath();
  const normalized = normalizeData(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function normalizeRendererUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return "";
    }

    const normalizedUrl = parsedUrl.toString();
    const isOriginOnly = parsedUrl.pathname === "/" && !parsedUrl.search && !parsedUrl.hash;

    return isOriginOnly ? normalizedUrl.replace(/\/$/, "") : normalizedUrl;
  } catch {
    return "";
  }
}

function readRendererConfig() {
  const configPath = path.join(__dirname, RENDERER_CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error("Failed to read Sherlly renderer config:", error);
    return {};
  }
}

function getPackagedRendererUrl() {
  const config = readRendererConfig();

  return (
    normalizeRendererUrl(process.env.SHERLLY_RENDERER_URL) ||
    normalizeRendererUrl(process.env.ELECTRON_RENDERER_URL) ||
    normalizeRendererUrl(config.productionRendererUrl)
  );
}

function createTrayIcon(fill, accentFill) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect width="16" height="16" rx="4" fill="${fill}"/>
      <path d="M4 5.3c0-1.2 1.3-2.1 2.8-1.5l4.1 1.6c1.4.6 1.4 2.5 0 3.1L6.8 10c-1.5.6-2.8-.3-2.8-1.5v-.2l3.9-.7c.4-.1.4-.7 0-.8L4 6.7v-1.4z" fill="white"/>
      <circle cx="11.5" cy="4" r="2" fill="${accentFill}"/>
    </svg>
  `;

  try {
    const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    return image.isEmpty() ? nativeImage.createEmpty() : image;
  } catch (error) {
    console.error("Failed to create Sherlly tray icon:", error);
    return nativeImage.createEmpty();
  }
}

function getTrayImages() {
  if (!trayImages) {
    trayImages = {
      base: createTrayIcon("#12715f", "#dceee8"),
      alert: createTrayIcon("#c94738", "#fff2a8"),
    };
  }

  return trayImages;
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
  }

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function sendQuickCaptureSignal() {
  if (!mainWindow) {
    return;
  }

  const sendSignal = () => {
    if (mainWindow) {
      mainWindow.webContents.send("sherlly:quick-capture");
    }
  };

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", sendSignal);
    return;
  }

  sendSignal();
}

function sanitizeUpdateInfo(info = {}) {
  return {
    version: String(info.version || ""),
    releaseName: String(info.releaseName || ""),
    releaseDate: String(info.releaseDate || ""),
    releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : "",
  };
}

function getUpdateStatusSnapshot(extra = {}) {
  const latestVersion = extra.latestVersion || updateStatus.latestVersion || updateStatus.info?.version || "";

  return {
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    latestVersion,
    progress: 0,
    ...updateStatus,
    ...extra,
  };
}

function sendUpdateStatus(nextStatus = {}) {
  updateStatus = {
    ...updateStatus,
    ...nextStatus,
  };

  const snapshot = getUpdateStatusSnapshot();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sherlly:update-status", snapshot);
  }

  return snapshot;
}

function getUpdateUnavailableStatus() {
  return getUpdateStatusSnapshot({
    state: app.isPackaged ? "idle" : "unsupported",
    message: app.isPackaged ? "" : "开发环境暂不支持自动更新",
  });
}

function getUpdateErrorMessage(error, fallbackMessage) {
  const message = String(error?.message || error || "");

  if (/404|not found|releases\.atom|github\.com/i.test(message)) {
    return `无法访问 GitHub Release 更新源（${UPDATE_REPOSITORY}）。请确认仓库 Release 对用户可访问，或先手动下载安装包。`;
  }

  if (/authentication token|unauthorized|forbidden|401|403/i.test(message)) {
    return "GitHub Release 更新源需要权限，当前安装包无法自动获取更新。";
  }

  return fallbackMessage;
}

function checkForUpdates() {
  if (!app.isPackaged) {
    return Promise.resolve(sendUpdateStatus(getUpdateUnavailableStatus()));
  }

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = autoUpdater
    .checkForUpdates()
    .then(() => getUpdateStatusSnapshot())
    .catch((error) => {
      console.error("Failed to check for Sherlly updates:", error);
      return sendUpdateStatus({
        state: "error",
        message: getUpdateErrorMessage(error, "检查更新失败"),
      });
    })
    .finally(() => {
      updateCheckPromise = null;
    });

  return updateCheckPromise;
}

function downloadUpdate() {
  if (!app.isPackaged) {
    return Promise.resolve(sendUpdateStatus(getUpdateUnavailableStatus()));
  }

  pendingInstallAfterDownload = true;

  if (updateStatus.state === "downloaded") {
    installDownloadedUpdate();
    return Promise.resolve(getUpdateStatusSnapshot({ state: "installing", progress: 100 }));
  }

  if (updateDownloadPromise) {
    return updateDownloadPromise;
  }

  sendUpdateStatus({
    state: "downloading",
    message: "正在下载更新",
    progress: 0,
  });

  updateDownloadPromise = autoUpdater
    .downloadUpdate()
    .then(() => getUpdateStatusSnapshot())
    .catch((error) => {
      pendingInstallAfterDownload = false;
      console.error("Failed to download Sherlly update:", error);
      return sendUpdateStatus({
        state: "error",
        message: getUpdateErrorMessage(error, "下载更新失败"),
      });
    })
    .finally(() => {
      updateDownloadPromise = null;
    });

  return updateDownloadPromise;
}

function installDownloadedUpdate() {
  if (!app.isPackaged) {
    return getUpdateUnavailableStatus();
  }

  sendUpdateStatus({
    state: "installing",
    message: "正在重启并安装更新",
    progress: 100,
  });

  setTimeout(() => {
    autoUpdater.quitAndInstall(true, true);
  }, 600);

  return getUpdateStatusSnapshot();
}

function setupAutoUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({
      state: "checking",
      message: "正在检查更新",
    });
  });

  autoUpdater.on("update-available", (info) => {
    const normalizedInfo = sanitizeUpdateInfo(info);
    sendUpdateStatus({
      state: "available",
      message: "发现新版本",
      info: normalizedInfo,
      latestVersion: normalizedInfo.version,
      progress: 0,
    });

    notify({
      title: "发现 Sherlly 新版本",
      body: normalizedInfo.version ? `新版本 ${normalizedInfo.version} 可以安装。` : "有新版本可以安装。",
      sound: false,
      flash: true,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    const normalizedInfo = sanitizeUpdateInfo(info);
    sendUpdateStatus({
      state: "idle",
      message: "",
      info: normalizedInfo,
      latestVersion: normalizedInfo.version,
      progress: 0,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({
      state: "downloading",
      message: "正在下载更新",
      progress: Math.max(0, Math.min(100, Math.round(progress.percent || 0))),
      bytesPerSecond: progress.bytesPerSecond || 0,
      transferred: progress.transferred || 0,
      total: progress.total || 0,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const normalizedInfo = sanitizeUpdateInfo(info);
    sendUpdateStatus({
      state: "downloaded",
      message: "更新已下载",
      info: normalizedInfo,
      latestVersion: normalizedInfo.version,
      progress: 100,
    });

    if (pendingInstallAfterDownload) {
      installDownloadedUpdate();
    }
  });

  autoUpdater.on("error", (error) => {
    pendingInstallAfterDownload = false;
    sendUpdateStatus({
      state: "error",
      message: getUpdateErrorMessage(error, "自动更新失败"),
    });
  });
}

function triggerQuickCapture() {
  showMainWindow();
  sendQuickCaptureSignal();
}

function stopTrayFlash() {
  if (trayFlashTimer) {
    clearInterval(trayFlashTimer);
    trayFlashTimer = null;
  }

  trayFlashTick = 0;
  trayFlashActive = false;

  if (tray) {
    tray.setImage(getTrayImages().base);
  }
}

function startTrayFlash() {
  if (!tray) {
    return;
  }

  stopTrayFlash();
  trayFlashTimer = setInterval(() => {
    trayFlashActive = !trayFlashActive;
    trayFlashTick += 1;
    tray.setImage(trayFlashActive ? getTrayImages().alert : getTrayImages().base);

    if (trayFlashTick >= 12) {
      stopTrayFlash();
    }
  }, 350);
}

async function canUseRendererUrl(rendererUrl) {
  if (!rendererUrl) {
    return false;
  }

  if (process.env.ELECTRON_RENDERER_URL || process.env.SHERLLY_RENDERER_URL) {
    return true;
  }

  if (app.isPackaged && rendererUrl === LOCAL_DEV_RENDERER_URL) {
    return false;
  }

  try {
    const response = await fetch(rendererUrl, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: "#f5f7f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distIndex = path.join(__dirname, "..", "dist", "index.html");
  const preferredRendererUrl = app.isPackaged ? getPackagedRendererUrl() : DEV_RENDERER_URL;

  canUseRendererUrl(preferredRendererUrl).then((useRendererUrl) => {
    if (!mainWindow) {
      return;
    }

    if (useRendererUrl) {
      mainWindow.loadURL(preferredRendererUrl);
      return;
    }

    if (fs.existsSync(distIndex)) {
      mainWindow.loadFile(distIndex);
      return;
    }

    mainWindow.loadURL(DEV_RENDERER_URL);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(getTrayImages().base);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开 Sherlly",
        click: () => {
          stopTrayFlash();
          showMainWindow();
        },
      },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ]),
  );
  tray.on("click", () => {
    stopTrayFlash();
    showMainWindow();
  });
}

function registerShortcuts() {
  const registered = globalShortcut.register(QUICK_CAPTURE_SHORTCUT, triggerQuickCapture);

  if (!registered) {
    console.warn(`Failed to register quick capture shortcut: ${QUICK_CAPTURE_SHORTCUT}`);
  }
}

function notify(payload = {}) {
  const title = payload.title || "Sherlly Assistant";
  const body = payload.body || "你有一个待处理事项";

  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      silent: payload.sound === false,
    }).show();
  }

  if (mainWindow && payload.flash !== false) {
    mainWindow.flashFrame(true);
  }

  if (payload.flash !== false) {
    startTrayFlash();
  }
}

function splitCommandLine(value) {
  const matches = String(value || "").match(/"[^"]+"|'[^']+'|\S+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

function spawnDetached(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function launchTaskAction(action = {}) {
  const type = action.type || "none";
  const target = String(action.target || "").trim();

  if (type === "none" || !target) {
    return { ok: false, message: "未配置执行动作" };
  }

  if (type === "url") {
    await shell.openExternal(target);
    return { ok: true };
  }

  if (type === "path") {
    const errorMessage = await shell.openPath(target);
    return errorMessage ? { ok: false, message: errorMessage } : { ok: true };
  }

  if (type === "vscode") {
    try {
      await spawnDetached("code", [target]);
      return { ok: true };
    } catch (error) {
      const errorMessage = await shell.openPath(target);
      return errorMessage ? { ok: false, message: errorMessage || error.message } : { ok: true };
    }
  }

  if (type === "command") {
    const [command, ...args] = splitCommandLine(target);

    if (!command) {
      return { ok: false, message: "软件命令不能为空" };
    }

    await spawnDetached(command, args);
    return { ok: true };
  }

  return { ok: false, message: "不支持的执行动作类型" };
}

async function selectAttachments() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择任务附件",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });

  if (result.canceled) {
    return { ok: true, filePaths: [] };
  }

  return { ok: true, filePaths: result.filePaths };
}

function getAttachmentPreview(attachment = {}) {
  const target = String(attachment.path || "").trim();
  const mimeTypes = {
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  const extension = path.extname(target).toLowerCase();
  const mimeType = mimeTypes[extension];

  if (!target) {
    return { ok: false, message: "附件路径不能为空" };
  }

  if (!mimeType) {
    return { ok: false, message: "非图片附件暂不支持预览，可以直接打开附件。" };
  }

  try {
    if (!fs.existsSync(target)) {
      return { ok: false, message: "附件文件不存在或已移动。" };
    }

    const stats = fs.statSync(target);
    const maxPreviewSize = 8 * 1024 * 1024;

    if (stats.size > maxPreviewSize) {
      return { ok: false, message: "图片超过 8MB，建议直接打开原文件查看。" };
    }

    const imageUrl = `data:${mimeType};base64,${fs.readFileSync(target).toString("base64")}`;
    return {
      ok: true,
      imageUrl,
      name: attachment.name || path.basename(target),
      type: "image",
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message || "无法读取图片预览。",
    };
  }
}

async function openAttachment(filePath) {
  const target = String(filePath || "").trim();

  if (!target) {
    return { ok: false, message: "附件路径不能为空" };
  }

  const errorMessage = await shell.openPath(target);
  return errorMessage ? { ok: false, message: errorMessage } : { ok: true };
}

app.setName(APP_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);
Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  setupAutoUpdates();

  ipcMain.handle("sherlly:load-data", () => readDataFile());
  ipcMain.handle("sherlly:save-data", (_event, data) => writeDataFile(data));
  ipcMain.handle("sherlly:notify", (_event, payload) => {
    notify(payload);
    return true;
  });
  ipcMain.handle("sherlly:launch-action", async (_event, action) => {
    try {
      return await launchTaskAction(action);
    } catch (error) {
      return { ok: false, message: error.message || "执行动作失败" };
    }
  });
  ipcMain.handle("sherlly:select-attachments", () => selectAttachments());
  ipcMain.handle("sherlly:get-attachment-preview", (_event, attachment) => getAttachmentPreview(attachment));
  ipcMain.handle("sherlly:open-attachment", (_event, filePath) => openAttachment(filePath));
  ipcMain.handle("sherlly:get-update-status", () => getUpdateStatusSnapshot());
  ipcMain.handle("sherlly:check-for-updates", () => checkForUpdates());
  ipcMain.handle("sherlly:download-update", () => downloadUpdate());
  ipcMain.handle("sherlly:install-update", () => installDownloadedUpdate());

  createWindow();
  createTray();
  registerShortcuts();

  if (app.isPackaged) {
    setTimeout(() => {
      checkForUpdates().catch((error) => console.error("Failed to run scheduled Sherlly update check:", error));
    }, 5000);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopTrayFlash();
  globalShortcut.unregister(QUICK_CAPTURE_SHORTCUT);
});
