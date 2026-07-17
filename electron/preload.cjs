const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sherlly", {
  loadData: () => ipcRenderer.invoke("sherlly:load-data"),
  saveData: (data) => ipcRenderer.invoke("sherlly:save-data", data),
  getDeviceKey: () => ipcRenderer.invoke("sherlly:get-device-key"),
  getShortcutStatus: () => ipcRenderer.invoke("sherlly:get-shortcut-status"),
  notify: (payload) => ipcRenderer.invoke("sherlly:notify", payload),
  launchAction: (action) => ipcRenderer.invoke("sherlly:launch-action", action),
  selectAttachments: () => ipcRenderer.invoke("sherlly:select-attachments"),
  getAttachmentPreview: (attachment) => ipcRenderer.invoke("sherlly:get-attachment-preview", attachment),
  openAttachment: (filePath) => ipcRenderer.invoke("sherlly:open-attachment", filePath),
  getUpdateStatus: () => ipcRenderer.invoke("sherlly:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("sherlly:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("sherlly:download-update"),
  installUpdate: () => ipcRenderer.invoke("sherlly:install-update"),
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = (_event, status) => callback(status);
    ipcRenderer.on("sherlly:update-status", listener);
    return () => ipcRenderer.removeListener("sherlly:update-status", listener);
  },
  onQuickCapture: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = () => callback();
    ipcRenderer.on("sherlly:quick-capture", listener);
    return () => ipcRenderer.removeListener("sherlly:quick-capture", listener);
  },
});
