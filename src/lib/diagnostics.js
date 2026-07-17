export async function runClientDiagnostics(syncStatus = {}) {
  const notification = typeof Notification === "undefined"
    ? "unsupported"
    : Notification.permission;
  const storage = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const registration = navigator.serviceWorker?.getRegistration
    ? await navigator.serviceWorker.getRegistration().catch(() => null)
    : null;
  const shortcut = window.sherlly?.getShortcutStatus
    ? await window.sherlly.getShortcutStatus().catch(() => null)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    notification,
    secureContext: window.isSecureContext,
    serviceWorker: Boolean(registration),
    storageUsageBytes: Number(storage?.usage || 0),
    storageQuotaBytes: Number(storage?.quota || 0),
    syncStatus: String(syncStatus.status || "idle"),
    lastSyncedAt: String(syncStatus.lastSyncedAt || ""),
    shortcut: shortcut?.registered === false ? "conflict" : shortcut?.registered ? "registered" : "unknown",
  };
}
