const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sherlly", {
  loadData: () => ipcRenderer.invoke("sherlly:load-data"),
  saveData: (data) => ipcRenderer.invoke("sherlly:save-data", data),
  notify: (payload) => ipcRenderer.invoke("sherlly:notify", payload),
  launchAction: (action) => ipcRenderer.invoke("sherlly:launch-action", action),
  selectAttachments: () => ipcRenderer.invoke("sherlly:select-attachments"),
  openAttachment: (filePath) => ipcRenderer.invoke("sherlly:open-attachment", filePath),
  onQuickCapture: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener = () => callback();
    ipcRenderer.on("sherlly:quick-capture", listener);
    return () => ipcRenderer.removeListener("sherlly:quick-capture", listener);
  },
});
