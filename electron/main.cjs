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
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "Sherlly Assistant";
const APP_USER_MODEL_ID = "com.sherlly.assistant";
const DATA_FILE_NAME = "sherlly-data.json";
const QUICK_CAPTURE_SHORTCUT = "CommandOrControl+Alt+S";
const DEV_RENDERER_URL = process.env.ELECTRON_RENDERER_URL || "http://127.0.0.1:5188";

let mainWindow = null;
let tray = null;
let trayImages = null;
let trayFlashTimer = null;
let trayFlashTick = 0;
let trayFlashActive = false;

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

function readDataFile() {
  const filePath = getDataPath();

  if (!fs.existsSync(filePath)) {
    return defaultData;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to read Sherlly data file:", error);
    return defaultData;
  }
}

function writeDataFile(data) {
  const filePath = getDataPath();
  const normalized = normalizeData(data);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
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

async function canUseDevRenderer() {
  if (process.env.ELECTRON_RENDERER_URL) {
    return true;
  }

  if (app.isPackaged) {
    return false;
  }

  try {
    const response = await fetch(DEV_RENDERER_URL, {
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

  canUseDevRenderer().then((useDevRenderer) => {
    if (!mainWindow) {
      return;
    }

    if (useDevRenderer) {
      mainWindow.loadURL(DEV_RENDERER_URL);
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
  tray.setToolTip(APP_PROTOCOL_NAME);
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

  createWindow();
  createTray();
  registerShortcuts();

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
