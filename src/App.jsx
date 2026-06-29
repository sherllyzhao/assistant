import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Filter,
  Image as ImageIcon,
  Inbox,
  KeyRound,
  ListChecks,
  LogIn,
  LogOut,
  Megaphone,
  MessageSquareText,
  Paperclip,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  Wand2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  candidateToDraft,
  createLog,
  createDailySlotReminderRecord,
  createAiWorkspaceAnswer,
  createTask,
  createId,
  dailySlots,
  detectCandidatesFromText,
  createDailyReport,
  createAttachment,
  createTaskOrganizingSuggestions,
  createVaultPlaintext,
  createWorkMemoryLibrary,
  DEFAULT_FTP_CLIENT_PATH,
  emptyTaskDraft,
  emptyVaultDraft,
  filterLogsByRange,
  formatDateTime,
  getDailyProgress,
  getDailySlotReminderKey,
  getPendingDailySlotReminder,
  getPriorityMeta,
  getReminderIntervalMinutes,
  getStatusMeta,
  getTaskReminderAt,
  getTaskReminderWindow,
  isActiveTask,
  isOverdue,
  launchActionTypes,
  logRanges,
  maskSecretValue,
  normalizeLaunchAction,
  normalizeAttachments,
  normalizeDailySlotReminderRecords,
  normalizeDailyTarget,
  normalizeDailySlots,
  normalizeReminderWindow,
  normalizeTags,
  normalizeVaultItem,
  normalizeVaultItems,
  priorities,
  shouldRemindCandidate,
  shouldRemindTask,
  taskStatuses,
  toDateTimeInputValue,
  vaultCategories,
} from "./lib/domain.js";
import { decryptVaultPayload, encryptVaultPayload, hasVaultCryptoSupport } from "./lib/vaultCrypto.js";
import {
  initialData,
  changePassword,
  isSameData,
  launchAction,
  loadAppData,
  mergeData,
  saveAppData,
  sendNotification,
  selectAttachments,
  getAttachmentPreview,
  getStoredAccount,
  isAuthRequiredError,
  getTurnstileSiteKey,
  loginAccount,
  logoutAccount,
  openAttachment,
  registerAccount,
} from "./lib/storage.js";

const filterOptions = [
  { value: "active", label: "未完成" },
  { value: "all", label: "全部" },
  { value: "todo", label: "待办" },
  { value: "doing", label: "进行中" },
  { value: "waiting", label: "等待他人" },
  { value: "done", label: "已完成" },
];

const sourceOptions = [
  { value: "手动录入", label: "手动录入" },
  { value: "快捷键速记", label: "快捷键速记" },
  { value: "手机速记", label: "手机速记" },
  { value: "微信粘贴", label: "微信粘贴" },
  { value: "拖拽文本", label: "拖拽文本" },
];

const ownerOptions = [
  { value: "自己", label: "自己" },
  { value: "同事", label: "同事" },
  { value: "客户", label: "客户" },
];

const viewOptions = [
  { value: "tasks", label: "任务看板", description: "录入、筛选和推进待办" },
  { value: "assistant", label: "AI工作台", description: "询问今日、本周和项目进展" },
  { value: "memory", label: "长期记忆", description: "沉淀联系人、项目和排期习惯" },
  { value: "vault", label: "安全速记", description: "保存账号、密码和密钥" },
  { value: "report", label: "工作日报", description: "查看日报概览与日志明细" },
];

const assistantQuestionPresets = [
  "今天还有什么没完成？",
  "本周最重要的事情是什么？",
  "等待他人的事情有哪些？",
  "王总的事情进展如何？",
  "长期没推进的任务有哪些？",
];

const cloudSyncEnabled = Boolean(import.meta.env.VITE_SHERLLY_API_URL);
const turnstileSiteKey = getTurnstileSiteKey();
const REMINDER_ALERT_AUTO_DISMISS_MS = 5000;
const CLOCK_TICK_MS = 60 * 1000;
const VAULT_UNLOCK_TTL_MS = 2 * 60 * 1000;
const visibleUpdateStates = new Set(["available", "downloading", "downloaded", "installing", "error"]);
const imageMimeExtensions = {
  "image/apng": "apng",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function withCurrentOption(options, value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue || options.some((option) => option.value === cleanValue)) {
    return options;
  }

  return [...options, { value: cleanValue, label: `${cleanValue}（旧值）` }];
}

function normalizeUpdateStatus(status = {}) {
  const progress = Number.parseInt(status.progress || 0, 10);

  return {
    state: status.state || "idle",
    message: status.message || "",
    currentVersion: status.currentVersion || "",
    latestVersion: status.latestVersion || status.info?.version || "",
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    isPackaged: Boolean(status.isPackaged),
  };
}

function getUpdateDismissKey(status) {
  return [status.state, status.latestVersion, status.message].filter(Boolean).join(":");
}

function shouldShowUpdateStatus(status, dismissedKey) {
  if (!visibleUpdateStates.has(status.state)) {
    return false;
  }

  if (["downloading", "downloaded", "installing"].includes(status.state)) {
    return true;
  }

  return getUpdateDismissKey(status) !== dismissedKey;
}

function getPrioritySortValue(priority) {
  return { high: 0, normal: 1, low: 2 }[priority] ?? 1;
}

function getDueTime(task) {
  const dueTime = task?.dueAt ? new Date(task.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
  return Number.isFinite(dueTime) ? dueTime : Number.MAX_SAFE_INTEGER;
}

function sortTasksByFocus(left, right) {
  return getPrioritySortValue(left.priority) - getPrioritySortValue(right.priority) || getDueTime(left) - getDueTime(right);
}

function getEndOfLocalDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function getMobileFocusTasks(tasks, now = new Date()) {
  const dayEndTime = getEndOfLocalDay(now).getTime();

  return tasks
    .filter((task) => isActiveTask(task))
    .filter((task) => {
      const dueTime = getDueTime(task);
      const dailyProgress = getDailyProgress(task, now);

      return dueTime <= dayEndTime || task.priority === "high" || dailyProgress.isScheduled;
    })
    .sort(sortTasksByFocus)
    .slice(0, 8);
}

function escapeIcsText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatIcsDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createTaskCalendarText(task) {
  const reminderWindow = getTaskReminderWindow(task);
  const start = new Date(reminderWindow.reminderStartAt || task.dueAt);
  const end = reminderWindow.reminderEndAt
    ? new Date(reminderWindow.reminderEndAt)
    : new Date(start.getTime() + 30 * 60 * 1000);
  const reminderMinutes = getReminderIntervalMinutes(task);
  const uid = `${task.id || Date.now()}@sherlly-assistant`;
  const description = [task.note, task.owner ? `负责人：${task.owner}` : "", task.source ? `来源：${task.source}` : ""]
    .filter(Boolean)
    .join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sherlly Assistant//Task Reminder//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(task.title)}`,
    `DESCRIPTION:${escapeIcsText(description || task.title)}`,
    "BEGIN:VALARM",
    `TRIGGER:-PT${reminderMinutes}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`${task.title}，提前${reminderMinutes}分钟提醒`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function getSafeFilename(value) {
  return (
    String(value || "sherlly-task")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 48) || "sherlly-task"
  );
}

function formatReminderWindow(task) {
  const reminderWindow = getTaskReminderWindow(task);

  if (!reminderWindow.reminderStartAt || !reminderWindow.reminderEndAt) {
    return "";
  }

  return `${formatDateTime(reminderWindow.reminderStartAt)} - ${formatDateTime(reminderWindow.reminderEndAt)}`;
}

function taskToDraft(task) {
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const reminderWindow = getTaskReminderWindow(task);

  return {
    title: task.title || "",
    source: task.source || "手动录入",
    owner: task.owner || "",
    dueAt: toDateTimeInputValue(task.dueAt),
    reminderStartAt: toDateTimeInputValue(reminderWindow.reminderStartAt),
    reminderEndAt: toDateTimeInputValue(reminderWindow.reminderEndAt),
    dailyTarget: normalizeDailyTarget(task.dailyTarget),
    dailySlotValues: normalizeDailySlots(task.dailySlots, task.dailyTarget),
    launchAction: normalizeLaunchAction(task.launchAction),
    priority: task.priority || "normal",
    status: task.status || "todo",
    tags: tags.join(" "),
    note: task.note || "",
    attachments: normalizeAttachments(task.attachments),
  };
}

function taskToCopyDraft(task) {
  return {
    ...taskToDraft(task),
    status: "todo",
    attachments: normalizeAttachments(task.attachments).map((attachment) => ({
      ...attachment,
      id: createId("attachment"),
    })),
  };
}

function getVaultFtpClientPath(settings) {
  return String(settings?.ftpClientPath || "").trim() || DEFAULT_FTP_CLIENT_PATH;
}

function isFtpVaultTarget(item, url) {
  return item?.category === "ftp" || /^(ftp|sftp):\/\//i.test(String(url || "").trim());
}

function getVaultBrowserUrl(url) {
  const target = String(url || "").trim();

  if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) {
    return target;
  }

  return `https://${target}`;
}

function App() {
  const [data, setData] = useState(initialData);
  const [account, setAccount] = useState(() => (cloudSyncEnabled ? getStoredAccount() : null));
  const [authMode, setAuthMode] = useState("login");
  const [authDraft, setAuthDraft] = useState({ username: "", password: "", displayName: "" });
  const [authError, setAuthError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: "", nextPassword: "", confirmPassword: "" });
  const [passwordStatus, setPasswordStatus] = useState({ type: "", message: "" });
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [draft, setDraft] = useState(emptyTaskDraft);
  const [editingId, setEditingId] = useState("");
  const [vaultDraft, setVaultDraft] = useState(emptyVaultDraft);
  const [vaultEditingId, setVaultEditingId] = useState("");
  const [vaultMasterPassword, setVaultMasterPassword] = useState("");
  const [vaultSearchQuery, setVaultSearchQuery] = useState("");
  const [vaultCategoryFilter, setVaultCategoryFilter] = useState("all");
  const [vaultUnlockedItems, setVaultUnlockedItems] = useState({});
  const [vaultStatus, setVaultStatus] = useState({ type: "", message: "" });
  const [wechatText, setWechatText] = useState("");
  const [activeView, setActiveView] = useState("tasks");
  const [assistantQuestion, setAssistantQuestion] = useState(assistantQuestionPresets[0]);
  const [assistantDraftQuestion, setAssistantDraftQuestion] = useState(assistantQuestionPresets[0]);
  const [taskFilter, setTaskFilter] = useState("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [logRange, setLogRange] = useState("today");
  const [reminderAlerts, setReminderAlerts] = useState([]);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [detailTaskId, setDetailTaskId] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDraggingText, setIsDraggingText] = useState(false);
  const [updateStatus, setUpdateStatus] = useState(() => normalizeUpdateStatus());
  const [dismissedUpdateKey, setDismissedUpdateKey] = useState("");
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const [mobileQuickText, setMobileQuickText] = useState("");
  const [mobileCaptureStatus, setMobileCaptureStatus] = useState("");
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const saveTimerRef = useRef(0);
  const titleInputRef = useRef(null);
  const reminderAlertTimersRef = useRef(new Map());
  const speechRecognitionRef = useRef(null);
  const dailySlotReminderKeysRef = useRef(new Set());
  const vaultUnlockTimersRef = useRef(new Map());

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(new Date()), CLOCK_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (cloudSyncEnabled && !account) {
      setData(initialData);
      setIsLoaded(true);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoaded(false);
    loadAppData()
      .then((loadedData) => {
        if (isCancelled) {
          return;
        }

        setData(loadedData);
        setAuthError("");
        setSyncError("");
        setIsLoaded(true);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }

        console.error(error);

        if (isAuthRequiredError(error)) {
          setAccount(null);
          setAuthError(error.message || "请先登录 Sherlly 账号");
          setSyncError("");
          setIsLoaded(true);
          return;
        }

        setSyncError(error.message || "云端读取失败，请检查网络或后台服务");
        setIsLoaded(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [account?.id]);

  useEffect(() => {
    if (!isLoaded || (cloudSyncEnabled && !account)) {
      return;
    }

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveAppData(data).catch((error) => {
        console.error(error);

        if (isAuthRequiredError(error)) {
          setAccount(null);
          setAuthError(error.message || "请重新登录 Sherlly 账号");
          setSyncError("");
          return;
        }

        setSyncError(error.message || "云端保存失败，已尽量保留本地缓存");
      });
    }, 250);

    return () => window.clearTimeout(saveTimerRef.current);
  }, [account, data, isLoaded]);

  useEffect(() => {
    if (!isLoaded || !cloudSyncEnabled || !account) {
      return;
    }

    let isCancelled = false;

    const syncFromCloud = () => {
      loadAppData()
        .then((cloudData) => {
          if (isCancelled) {
            return;
          }

          setData((current) => {
            const mergedData = mergeData(cloudData, current);
            return isSameData(current, mergedData) ? current : mergedData;
          });
        })
        .catch((error) => {
          console.error(error);

          if (isAuthRequiredError(error)) {
            setAccount(null);
            setAuthError(error.message || "请重新登录 Sherlly 账号");
            setSyncError("");
            return;
          }

          setSyncError(error.message || "云端同步失败，请稍后重试");
        });
    };

    syncFromCloud();
    const intervalId = window.setInterval(syncFromCloud, 5000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [account, isLoaded]);

  useEffect(() => {
    const handleQuickCapture = () => activateQuickCapture("快捷键速记");
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && event.altKey && key === "s") {
        event.preventDefault();
        handleQuickCapture();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const unsubscribeQuickCapture = window.sherlly?.onQuickCapture?.(handleQuickCapture);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unsubscribeQuickCapture?.();
    };
  }, [editingId]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    const checkReminders = () => {
      const now = new Date();
      const remindedTaskIds = [];
      const remindedCandidateIds = [];
      const dailySlotRemindersByTaskId = new Map();

      for (const task of data.tasks) {
        if (shouldRemindTask(task, now)) {
          const reminderWindowLabel = formatReminderWindow(task);
          remindedTaskIds.push(task.id);
          notifyWithFallback({
            id: `task_${task.id}_${now.getTime()}`,
            title: `${getPriorityMeta(task.priority).label}提醒`,
            body: `${task.title} · ${reminderWindowLabel || formatDateTime(task.dueAt)}`,
            sound: data.settings.soundEnabled,
            flash: true,
          });
        }

        const pendingSlotReminder = getPendingDailySlotReminder(task, now);

        if (!pendingSlotReminder) {
          continue;
        }

        const reminderKey = getDailySlotReminderKey(task, pendingSlotReminder, now);

        if (dailySlotReminderKeysRef.current.has(reminderKey)) {
          continue;
        }

        const reminderRecord = createDailySlotReminderRecord(task, pendingSlotReminder, now);
        dailySlotReminderKeysRef.current.add(reminderKey);
        dailySlotRemindersByTaskId.set(task.id, {
          record: reminderRecord,
        });
        notifyWithFallback({
          id: `daily_slot_${task.id}_${pendingSlotReminder.value}_${now.getTime()}`,
          title: `${pendingSlotReminder.label}任务提醒`,
          body: `${task.title} · 该完成这一次了`,
          sound: data.settings.soundEnabled,
          flash: true,
        });
      }

      for (const candidate of data.candidates) {
        if (shouldRemindCandidate(candidate, now)) {
          remindedCandidateIds.push(candidate.id);
          notifyWithFallback({
            id: `candidate_${candidate.id}_${now.getTime()}`,
            title: "发现可能遗漏的事项",
            body: candidate.text,
            sound: data.settings.soundEnabled,
            flash: true,
          });
        }
      }

      if (remindedTaskIds.length === 0 && remindedCandidateIds.length === 0 && dailySlotRemindersByTaskId.size === 0) {
        return;
      }

      setData((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          const dailySlotReminder = dailySlotRemindersByTaskId.get(task.id);
          const taskWithDueReminder = remindedTaskIds.includes(task.id)
            ? { ...task, lastRemindedAt: now.toISOString() }
            : task;

          if (!dailySlotReminder) {
            return taskWithDueReminder;
          }

          return {
            ...taskWithDueReminder,
            dailySlotReminderRecords: normalizeDailySlotReminderRecords([
              ...(Array.isArray(taskWithDueReminder.dailySlotReminderRecords)
                ? taskWithDueReminder.dailySlotReminderRecords
                : []),
              dailySlotReminder.record,
            ]),
            updatedAt: now.toISOString(),
          };
        }),
        candidates: current.candidates.map((candidate) =>
          remindedCandidateIds.includes(candidate.id)
            ? { ...candidate, remindedAt: now.toISOString() }
            : candidate,
        ),
      }));
    };

    checkReminders();
    const intervalId = window.setInterval(checkReminders, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [data, isLoaded]);

  useEffect(() => {
    if (!attachmentPreview) {
      return;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setAttachmentPreview(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachmentPreview]);

  useEffect(() => {
    return () => {
      for (const timerId of reminderAlertTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }

      reminderAlertTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const activeAlertIds = new Set(reminderAlerts.map((alert) => alert.id));

    for (const [alertId, timerId] of reminderAlertTimersRef.current.entries()) {
      if (activeAlertIds.has(alertId)) {
        continue;
      }

      window.clearTimeout(timerId);
      reminderAlertTimersRef.current.delete(alertId);
    }

    for (const alert of reminderAlerts) {
      if (reminderAlertTimersRef.current.has(alert.id)) {
        continue;
      }

      const timerId = window.setTimeout(() => {
        reminderAlertTimersRef.current.delete(alert.id);
        setReminderAlerts((current) => current.filter((item) => item.id !== alert.id));
      }, REMINDER_ALERT_AUTO_DISMISS_MS);

      reminderAlertTimersRef.current.set(alert.id, timerId);
    }
  }, [reminderAlerts]);

  useEffect(() => {
    if (!detailTaskId || attachmentPreview) {
      return;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setDetailTaskId("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [attachmentPreview, detailTaskId]);

  useEffect(() => {
    if (!window.sherlly?.onUpdateStatus) {
      return undefined;
    }

    let isCancelled = false;
    const applyUpdateStatus = (status) => {
      if (!isCancelled) {
        setUpdateStatus(normalizeUpdateStatus(status));
      }
    };

    window.sherlly.getUpdateStatus?.().then(applyUpdateStatus).catch((error) => console.error(error));
    const unsubscribe = window.sherlly.onUpdateStatus(applyUpdateStatus);
    window.sherlly.checkForUpdates?.().catch((error) => console.error(error));

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      speechRecognitionRef.current?.abort?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of vaultUnlockTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
    };
  }, []);

  const taskStats = useMemo(() => {
    const activeTasks = data.tasks.filter((task) => !["done", "cancelled"].includes(task.status));

    return {
      active: activeTasks.length,
      overdue: activeTasks.filter((task) => isOverdue(task, currentTime)).length,
      waiting: data.tasks.filter((task) => task.status === "waiting").length,
      done: data.tasks.filter((task) => task.status === "done").length,
    };
  }, [currentTime, data.tasks]);

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return data.tasks
      .filter((task) => {
        if (taskFilter === "active") {
          return !["done", "cancelled"].includes(task.status);
        }

        if (taskFilter === "all") {
          return true;
        }

        return task.status === taskFilter;
      })
      .filter((task) => {
        if (!query) {
          return true;
        }

        const attachmentText = normalizeAttachments(task.attachments)
          .map((attachment) => attachment.name)
          .join(" ");
        const searchable = [task.title, task.source, task.owner, task.note, task.tags.join(" "), attachmentText]
          .join(" ")
          .toLowerCase();
        return searchable.includes(query);
      })
      .sort((a, b) => {
        const priorityScore = { high: 0, normal: 1, low: 2 };
        const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return priorityScore[a.priority] - priorityScore[b.priority] || dueA - dueB;
      });
  }, [data.tasks, searchQuery, taskFilter]);

  const vaultItems = useMemo(() => normalizeVaultItems(data.vaultItems), [data.vaultItems]);
  const filteredVaultItems = useMemo(() => {
    const query = vaultSearchQuery.trim().toLowerCase();

    return vaultItems
      .filter((item) => vaultCategoryFilter === "all" || item.category === vaultCategoryFilter)
      .filter((item) => {
        if (!query) {
          return true;
        }

        return [item.title, item.usernameHint, item.category, ...(Array.isArray(item.tags) ? item.tags : [])]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  }, [vaultCategoryFilter, vaultItems, vaultSearchQuery]);
  const vaultStats = useMemo(
    () => ({
      total: vaultItems.length,
      unlocked: Object.keys(vaultUnlockedItems).length,
    }),
    [vaultItems.length, vaultUnlockedItems],
  );

  const visibleLogs = useMemo(
    () => filterLogsByRange(data.logs, logRange, currentTime).slice().reverse(),
    [currentTime, data.logs, logRange],
  );

  const dailyReport = useMemo(
    () => createDailyReport(data.tasks, data.logs, logRange, currentTime),
    [currentTime, data.logs, data.tasks, logRange],
  );
  const aiWorkspaceAnswer = useMemo(
    () => createAiWorkspaceAnswer(data.tasks, data.logs, assistantQuestion, currentTime),
    [assistantQuestion, currentTime, data.logs, data.tasks],
  );
  const workMemoryLibrary = useMemo(
    () => createWorkMemoryLibrary(data.tasks, currentTime),
    [currentTime, data.tasks],
  );
  const organizingSuggestions = useMemo(
    () => createTaskOrganizingSuggestions(data.tasks, currentTime),
    [currentTime, data.tasks],
  );
  const mobileFocusTasks = useMemo(() => getMobileFocusTasks(data.tasks, currentTime), [currentTime, data.tasks]);
  const detailTask = useMemo(
    () => data.tasks.find((task) => task.id === detailTaskId) || null,
    [data.tasks, detailTaskId],
  );
  const selectedDraftSlots = useMemo(
    () => normalizeDailySlots(draft.dailySlotValues, draft.dailyTarget),
    [draft.dailySlotValues, draft.dailyTarget],
  );
  const draftAttachments = useMemo(
    () => normalizeAttachments(draft.attachments),
    [draft.attachments],
  );

  function pushReminderAlert(alert) {
    const createdAt = new Date().toISOString();

    setReminderAlerts((current) =>
      [
        {
          id: alert.id || `alert_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          title: alert.title || "任务提醒",
          body: alert.body || "",
          createdAt,
        },
        ...current,
      ].slice(0, 6),
    );
  }

  function dismissReminderAlert(alertId) {
    const timerId = reminderAlertTimersRef.current.get(alertId);

    if (timerId) {
      window.clearTimeout(timerId);
      reminderAlertTimersRef.current.delete(alertId);
    }

    setReminderAlerts((current) => current.filter((alert) => alert.id !== alertId));
  }

  function dismissUpdateBanner() {
    setDismissedUpdateKey(getUpdateDismissKey(updateStatus));
  }

  async function retryUpdateCheck() {
    if (!window.sherlly?.checkForUpdates) {
      return;
    }

    setIsUpdateActionPending(true);

    try {
      setUpdateStatus((current) => ({
        ...current,
        state: "checking",
        message: "正在检查更新",
      }));
      await window.sherlly.checkForUpdates();
      setDismissedUpdateKey("");
    } catch (error) {
      console.error(error);
      setUpdateStatus((current) => ({
        ...current,
        state: "error",
        message: error.message || "检查更新失败",
      }));
    } finally {
      setIsUpdateActionPending(false);
    }
  }

  async function downloadAndInstallUpdate() {
    if (!window.sherlly?.downloadUpdate) {
      return;
    }

    setIsUpdateActionPending(true);

    try {
      await window.sherlly.downloadUpdate();
      setDismissedUpdateKey("");
    } catch (error) {
      console.error(error);
      setUpdateStatus((current) => ({
        ...current,
        state: "error",
        message: error.message || "下载更新失败",
      }));
    } finally {
      setIsUpdateActionPending(false);
    }
  }

  function notifyWithFallback(payload) {
    pushReminderAlert(payload);
    sendNotification(payload).catch((error) => console.error(error));
  }

  function handleRefresh() {
    window.location.reload();
  }

  function askAssistant(question) {
    const cleanQuestion = String(question || "").trim() || assistantQuestionPresets[0];
    setAssistantDraftQuestion(cleanQuestion);
    setAssistantQuestion(cleanQuestion);
  }

  function downloadTaskCalendar(task) {
    const dueTime = task?.dueAt ? new Date(task.dueAt).getTime() : Number.NaN;

    if (!Number.isFinite(dueTime)) {
      setMobileCaptureStatus("这个任务还没有截止时间");
      notifyWithFallback({
        title: "无法添加到日历",
        body: "请先给任务设置截止时间。",
        sound: false,
        flash: false,
      });
      return;
    }

    const blob = new Blob([createTaskCalendarText(task)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${getSafeFilename(task.title)}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMobileCaptureStatus("日历文件已生成");
  }

  function createMobileQuickTask(text) {
    const cleanText = String(text || "").trim();

    if (!cleanText) {
      setMobileCaptureStatus("先输入一条任务");
      return;
    }

    const firstLine = cleanText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const task = createTask({
      ...emptyTaskDraft,
      title: (firstLine || cleanText).slice(0, 60),
      source: "手机速记",
      note: cleanText,
    });

    setData((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      logs: [...current.logs, createLog("创建任务", task, "手机速记")],
    }));
    setMobileQuickText("");
    const createdTimeLabel = formatReminderWindow(task) || (task.dueAt ? formatDateTime(task.dueAt) : "");
    setMobileCaptureStatus(createdTimeLabel ? `已创建：${createdTimeLabel}` : "已创建任务");
  }

  function submitMobileQuickTask(event) {
    event.preventDefault();
    createMobileQuickTask(mobileQuickText);
  }

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition;
  }

  function startMobileVoiceCapture() {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setMobileCaptureStatus("当前浏览器不支持语音输入");
      return;
    }

    if (isVoiceListening) {
      speechRecognitionRef.current?.stop?.();
      return;
    }

    const recognition = new SpeechRecognition();
    speechRecognitionRef.current = recognition;
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setIsVoiceListening(true);
      setMobileCaptureStatus("正在听写");
    };
    recognition.onresult = (event) => {
      const text = Array.from(event.results || [])
        .map((result) => result[0]?.transcript || "")
        .join("")
        .trim();

      if (text) {
        setMobileQuickText((current) => (current.trim() ? `${current.trim()} ${text}` : text));
        setMobileCaptureStatus("语音内容已填入");
      }
    };
    recognition.onerror = (event) => {
      setMobileCaptureStatus(event.error === "not-allowed" ? "需要允许麦克风权限" : "语音输入失败");
    };
    recognition.onend = () => {
      setIsVoiceListening(false);
    };
    recognition.start();
  }

  function completeMobileTask(task) {
    const progress = getDailyProgress(task, currentTime);

    if (progress.isScheduled) {
      completeTaskOnce(task);
      return;
    }

    changeTaskStatus(task, "done");
  }

  function focusTaskTitle() {
    titleInputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    titleInputRef.current?.focus();
  }

  function activateQuickCapture(source = "快捷键速记") {
    setActiveView("tasks");
    setTaskFilter("active");

    if (!editingId) {
      setDraft((current) => ({
        ...current,
        source: current.title || current.note ? current.source : source,
      }));
    }

    window.requestAnimationFrame(focusTaskTitle);
  }

  function hasTextTransfer(event) {
    return Array.from(event.dataTransfer?.types || []).some((type) => type === "text/plain" || type === "text");
  }

  function createDraggedTask(text) {
    const cleanText = String(text || "").trim();

    if (!cleanText) {
      return;
    }

    const firstLine = cleanText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    const task = createTask({
      ...emptyTaskDraft,
      title: (firstLine || cleanText).slice(0, 60),
      source: "拖拽文本",
      note: cleanText,
    });

    setData((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      logs: [...current.logs, createLog("创建任务", task, "拖拽文本创建任务")],
    }));
  }

  function handleTextDragOver(event) {
    if (!hasTextTransfer(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingText(true);
  }

  function handleTextDragLeave(event) {
    const relatedTarget = event.relatedTarget;

    if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) {
      setIsDraggingText(false);
    }
  }

  function handleTextDrop(event) {
    if (!hasTextTransfer(event)) {
      return;
    }

    event.preventDefault();
    setIsDraggingText(false);
    createDraggedTask(event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text"));
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function appendDraftAttachments(nextAttachments) {
    const normalizedNextAttachments = normalizeAttachments(nextAttachments);

    if (normalizedNextAttachments.length === 0) {
      return;
    }

    setDraft((current) => {
      const currentAttachments = normalizeAttachments(current.attachments);
      const existingPaths = new Set(currentAttachments.map((attachment) => attachment.path));
      const uniqueAttachments = normalizedNextAttachments.filter((attachment) => !existingPaths.has(attachment.path));

      if (uniqueAttachments.length === 0) {
        return current;
      }

      return {
        ...current,
        attachments: [...currentAttachments, ...uniqueAttachments],
      };
    });
  }

  async function addDraftAttachments() {
    const result = await selectAttachments();

    if (!result?.ok) {
      notifyWithFallback({
        title: "无法选择附件",
        body: result?.message || "请在 Electron 桌面端选择本机图片或文件。",
        sound: false,
        flash: false,
      });
      return;
    }

    const nextAttachments = (result.filePaths || []).map((filePath) => createAttachment(filePath));

    if (nextAttachments.length === 0) {
      return;
    }

    appendDraftAttachments(nextAttachments);
  }

  function getClipboardImageFiles(clipboardData) {
    const directFiles = Array.from(clipboardData?.files || []).filter((file) => file.type.startsWith("image/"));

    if (directFiles.length > 0) {
      return directFiles;
    }

    return Array.from(clipboardData?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(new Error("图片读取失败")));
      reader.readAsDataURL(file);
    });
  }

  function createPastedImageAttachment(dataUrl, file, index, now = new Date()) {
    const extension = imageMimeExtensions[file.type] || "png";
    const fallbackName = `粘贴图片-${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${index + 1}.${extension}`;
    const name = String(file.name || "").trim() || fallbackName;

    return {
      id: createId("attachment"),
      name,
      path: dataUrl,
      type: "image",
      addedAt: now.toISOString(),
    };
  }

  async function addImageFilesAsAttachments(files) {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));

    if (imageFiles.length === 0) {
      return;
    }

    try {
      const now = new Date();
      const imageAttachments = await Promise.all(
        imageFiles.map(async (file, index) => {
          const dataUrl = await readFileAsDataUrl(file);

          if (!dataUrl.startsWith("data:image/")) {
            throw new Error("剪贴板内容不是有效图片");
          }

          return createPastedImageAttachment(dataUrl, file, index, now);
        }),
      );

      appendDraftAttachments(imageAttachments);
      notifyWithFallback({
        title: "已添加粘贴图片",
        body: `已把 ${imageAttachments.length} 张图片加入当前任务附件。`,
        sound: false,
        flash: false,
      });
    } catch (error) {
      notifyWithFallback({
        title: "无法粘贴图片",
        body: error.message || "请确认剪贴板里是图片内容。",
        sound: false,
        flash: false,
      });
    }
  }

  async function pasteClipboardImages() {
    if (!navigator.clipboard?.read) {
      notifyWithFallback({
        title: "无法读取剪贴板",
        body: "当前环境不支持按钮读取图片，请在任务录入区直接粘贴图片。",
        sound: false,
        flash: false,
      });
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles = [];

      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));

        if (!imageType) {
          continue;
        }

        const blob = await item.getType(imageType);
        const extension = imageMimeExtensions[imageType] || "png";
        imageFiles.push(
          new File([blob], `粘贴图片-${Date.now()}-${imageFiles.length + 1}.${extension}`, {
            type: imageType,
          }),
        );
      }

      if (imageFiles.length === 0) {
        notifyWithFallback({
          title: "剪贴板没有图片",
          body: "请先复制截图或图片，再粘贴到任务附件。",
          sound: false,
          flash: false,
        });
        return;
      }

      await addImageFilesAsAttachments(imageFiles);
    } catch (error) {
      notifyWithFallback({
        title: "无法读取剪贴板",
        body: error.message || "请在任务录入区直接粘贴图片。",
        sound: false,
        flash: false,
      });
    }
  }

  function updateVaultDraft(field, value) {
    setVaultDraft((current) => ({ ...current, [field]: value }));
  }

  function updateVaultFtpClientPath(value) {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ftpClientPath: value,
      },
    }));
  }

  function resetVaultDraft() {
    setVaultDraft(emptyVaultDraft);
    setVaultEditingId("");
    setVaultStatus({ type: "", message: "" });
  }

  function scheduleVaultAutoLock(itemId) {
    const currentTimer = vaultUnlockTimersRef.current.get(itemId);

    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }

    const timerId = window.setTimeout(() => {
      setVaultUnlockedItems((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      vaultUnlockTimersRef.current.delete(itemId);
    }, VAULT_UNLOCK_TTL_MS);

    vaultUnlockTimersRef.current.set(itemId, timerId);
  }

  async function submitVaultItem(event) {
    event.preventDefault();
    setVaultStatus({ type: "", message: "" });

    if (!vaultDraft.title.trim()) {
      setVaultStatus({ type: "error", message: "先写一个标题，之后才好找。" });
      return;
    }

    if (vaultEditingId && !vaultUnlockedItems[vaultEditingId]) {
      setVaultStatus({ type: "error", message: "编辑前请先解锁这条安全速记，避免空内容覆盖旧密文。" });
      return;
    }

    if (!hasVaultCryptoSupport()) {
      setVaultStatus({ type: "error", message: "当前环境不支持安全加密，暂时不能保存密码。" });
      return;
    }

    try {
      const now = new Date();
      const plaintext = createVaultPlaintext(vaultDraft);
      const encrypted = await encryptVaultPayload(plaintext, vaultMasterPassword);
      const baseItem = vaultEditingId
        ? vaultItems.find((item) => item.id === vaultEditingId)
        : null;
      const vaultItem = normalizeVaultItem({
        ...(baseItem || {}),
        id: vaultEditingId || createId("vault"),
        title: vaultDraft.title.trim(),
        category: vaultDraft.category,
        tags: normalizeTags(vaultDraft.tags),
        usernameHint: maskSecretValue(plaintext.username, 2, 1),
        encrypted,
        createdAt: baseItem?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
      });

      setData((current) => ({
        ...current,
        vaultItems: vaultEditingId
          ? normalizeVaultItems(current.vaultItems).map((item) => (item.id === vaultEditingId ? vaultItem : item))
          : [vaultItem, ...normalizeVaultItems(current.vaultItems)],
        logs: [
          ...current.logs,
          createLog(vaultEditingId ? "修改安全速记" : "创建安全速记", { id: vaultItem.id, title: vaultItem.title }, "敏感内容已加密保存", now),
        ],
      }));
      setVaultUnlockedItems((current) => ({
        ...current,
        [vaultItem.id]: {
          ...plaintext,
          unlockedAt: now.toISOString(),
        },
      }));
      scheduleVaultAutoLock(vaultItem.id);
      setVaultStatus({ type: "success", message: vaultEditingId ? "安全速记已更新" : "安全速记已保存" });
      setVaultDraft(emptyVaultDraft);
      setVaultEditingId("");
    } catch (error) {
      setVaultStatus({ type: "error", message: error.message || "保存失败，请检查主密码。" });
    }
  }

  function editVaultItem(item) {
    const unlocked = vaultUnlockedItems[item.id];

    setActiveView("vault");
    setVaultEditingId(item.id);
    setVaultDraft({
      title: item.title,
      category: item.category,
      username: unlocked?.username || "",
      password: unlocked?.password || "",
      url: unlocked?.url || "",
      note: unlocked?.note || "",
      tags: Array.isArray(item.tags) ? item.tags.join(" ") : "",
    });
    setVaultStatus({
      type: unlocked ? "success" : "error",
      message: unlocked ? "已载入解锁内容，可编辑后重新加密保存。" : "请先解锁这条速记，再编辑敏感字段。",
    });
  }

  async function unlockVaultItem(item) {
    setVaultStatus({ type: "", message: "" });

    try {
      const plaintext = await decryptVaultPayload(item.encrypted, vaultMasterPassword);
      const now = new Date();

      setVaultUnlockedItems((current) => ({
        ...current,
        [item.id]: {
          ...plaintext,
          unlockedAt: now.toISOString(),
        },
      }));
      scheduleVaultAutoLock(item.id);
      setData((current) => ({
        ...current,
        vaultItems: normalizeVaultItems(current.vaultItems).map((vaultItem) =>
          vaultItem.id === item.id ? { ...vaultItem, lastViewedAt: now.toISOString() } : vaultItem,
        ),
        logs: [...current.logs, createLog("查看安全速记", { id: item.id, title: item.title }, "已解锁查看，日志不记录敏感内容", now)],
      }));
      setVaultStatus({ type: "success", message: "已解锁，敏感内容只在当前页面短时显示。" });
    } catch (error) {
      setVaultStatus({ type: "error", message: "解锁失败，请检查保险箱主密码。" });
    }
  }

  function lockVaultItem(itemId) {
    const currentTimer = vaultUnlockTimersRef.current.get(itemId);

    if (currentTimer) {
      window.clearTimeout(currentTimer);
      vaultUnlockTimersRef.current.delete(itemId);
    }

    setVaultUnlockedItems((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  async function copyVaultValue(item, field, label) {
    const unlocked = vaultUnlockedItems[item.id];
    const value = unlocked?.[field] || "";

    if (!value) {
      setVaultStatus({ type: "error", message: `没有可复制的${label}` });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      const now = new Date();
      setData((current) => ({
        ...current,
        logs: [...current.logs, createLog("复制安全速记", { id: item.id, title: item.title }, `复制${label}，日志不记录内容`, now)],
      }));
      setVaultStatus({ type: "success", message: `${label}已复制，30 秒后会尝试清空剪贴板。` });
      window.setTimeout(() => {
        navigator.clipboard?.writeText?.("").catch(() => {});
      }, 30 * 1000);
    } catch (error) {
      setVaultStatus({ type: "error", message: error.message || "复制失败，当前环境可能不允许访问剪贴板。" });
    }
  }

  async function openVaultTarget(item) {
    const unlocked = vaultUnlockedItems[item.id];
    const url = String(unlocked?.url || "").trim();
    const isFtpTarget = isFtpVaultTarget(item, url);

    if (!unlocked) {
      setVaultStatus({ type: "error", message: "请先解锁这条安全速记，再打开关联地址。" });
      return;
    }

    if (!isFtpTarget && !url) {
      setVaultStatus({ type: "error", message: "这条安全速记没有可打开的网址。" });
      return;
    }

    const action = isFtpTarget
      ? { type: "path", target: getVaultFtpClientPath(data.settings) }
      : { type: "url", target: getVaultBrowserUrl(url) };

    try {
      const result = await launchAction(action);
      const now = new Date();
      const detail = result?.ok
        ? isFtpTarget
          ? "已打开 FTP 客户端，日志不记录敏感内容"
          : "已打开浏览器网址，日志不记录网址内容"
        : `打开失败：${result?.message || "未知错误"}`;

      setData((current) => ({
        ...current,
        logs: [...current.logs, createLog(result?.ok ? "打开安全速记" : "修改安全速记", item, detail, now)],
      }));
      setVaultStatus({
        type: result?.ok ? "success" : "error",
        message: result?.ok ? (isFtpTarget ? "已打开 FTP 客户端。" : "已用浏览器打开网址。") : detail,
      });
    } catch (error) {
      setVaultStatus({ type: "error", message: error.message || "打开失败，请检查目标路径或网址。" });
    }
  }

  function deleteVaultItem(item) {
    const now = new Date();

    setData((current) => ({
      ...current,
      vaultItems: normalizeVaultItems(current.vaultItems).filter((vaultItem) => vaultItem.id !== item.id),
      logs: [...current.logs, createLog("删除安全速记", { id: item.id, title: item.title }, "已删除加密速记", now)],
    }));
    lockVaultItem(item.id);

    if (vaultEditingId === item.id) {
      resetVaultDraft();
    }

    setVaultStatus({ type: "success", message: `已删除「${item.title}」` });
  }

  function handleTaskFormPaste(event) {
    const imageFiles = getClipboardImageFiles(event.clipboardData);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    addImageFilesAsAttachments(imageFiles);
  }

  function removeDraftAttachment(attachmentId) {
    setDraft((current) => ({
      ...current,
      attachments: normalizeAttachments(current.attachments).filter((attachment) => attachment.id !== attachmentId),
    }));
  }

  async function previewAttachment(attachment) {
    const normalizedAttachment = normalizeAttachments([attachment])[0];

    if (!normalizedAttachment) {
      return;
    }

    setAttachmentPreview({
      attachment: normalizedAttachment,
      imageUrl: "",
      message: "",
      status: "loading",
    });

    try {
      const result = await getAttachmentPreview(normalizedAttachment);
      setAttachmentPreview((current) => {
        if (current?.attachment.id !== normalizedAttachment.id) {
          return current;
        }

        return {
          attachment: normalizedAttachment,
          imageUrl: result?.imageUrl || "",
          message: result?.message || "",
          status: result?.ok ? "ready" : "unavailable",
        };
      });
    } catch (error) {
      setAttachmentPreview((current) => {
        if (current?.attachment.id !== normalizedAttachment.id) {
          return current;
        }

        return {
          attachment: normalizedAttachment,
          imageUrl: "",
          message: error.message || "附件预览失败。",
          status: "unavailable",
        };
      });
    }
  }

  async function openTaskAttachment(attachment) {
    const result = await openAttachment(attachment.path);

    if (!result?.ok) {
      notifyWithFallback({
        title: "无法打开附件",
        body: result?.message || attachment.name,
        sound: false,
        flash: false,
      });
    }
  }

  function toggleDraftSlot(slotValue) {
    setDraft((current) => {
      const currentSlots = normalizeDailySlots(current.dailySlotValues, current.dailyTarget);
      const nextSlots = currentSlots.includes(slotValue)
        ? currentSlots.filter((value) => value !== slotValue)
        : [...currentSlots, slotValue];

      return {
        ...current,
        dailySlotValues: nextSlots,
        dailyTarget: nextSlots.length,
      };
    });
  }

  function clearDraftSlots() {
    setDraft((current) => ({
      ...current,
      dailySlotValues: [],
      dailyTarget: 0,
    }));
  }

  function updateDraftLaunchAction(field, value) {
    setDraft((current) => ({
      ...current,
      launchAction: {
        ...current.launchAction,
        [field]: value,
      },
    }));
  }

  function resetDraft() {
    setDraft(emptyTaskDraft);
    setEditingId("");
  }

  function submitTask(event) {
    event.preventDefault();

    if (!draft.title.trim()) {
      return;
    }

    if (editingId) {
      setData((current) => {
        let updatedTask = null;
        const tasks = current.tasks.map((task) => {
          if (task.id !== editingId) {
            return task;
          }

          const dailySlotValues = normalizeDailySlots(draft.dailySlotValues, draft.dailyTarget);
          const reminderWindow = normalizeReminderWindow(draft.reminderStartAt, draft.reminderEndAt);

          updatedTask = {
            ...task,
            title: draft.title.trim(),
            source: draft.source.trim(),
            owner: draft.owner.trim(),
            dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : reminderWindow.reminderEndAt,
            reminderStartAt: reminderWindow.reminderStartAt,
            reminderEndAt: reminderWindow.reminderEndAt,
            dailySlots: dailySlotValues,
            dailyTarget: dailySlotValues.length,
            launchAction: normalizeLaunchAction(draft.launchAction),
            priority: draft.priority,
            status: draft.status,
            tags: draft.tags
              .split(/[,，\s]+/)
              .map((tag) => tag.trim())
              .filter(Boolean),
            note: draft.note.trim(),
            attachments: normalizeAttachments(draft.attachments),
            updatedAt: new Date().toISOString(),
          };

          return updatedTask;
        });

        return {
          ...current,
          tasks,
          logs: updatedTask
            ? [...current.logs, createLog("修改任务", updatedTask, "更新任务属性")]
            : current.logs,
        };
      });
      resetDraft();
      return;
    }

    const task = createTask(draft);
    setData((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      logs: [...current.logs, createLog("创建任务", task, "手动录入")],
    }));
    resetDraft();
  }

  function editTask(task) {
    setActiveView("tasks");
    setEditingId(task.id);
    setDraft(taskToDraft(task));
  }

  function copyTask(task) {
    setActiveView("tasks");
    setEditingId("");
    setTaskFilter("active");
    setDraft(taskToCopyDraft(task));
    window.requestAnimationFrame(focusTaskTitle);
  }

  function changeTaskStatus(task, status) {
    const now = new Date();
    const updatedTask = {
      ...task,
      status,
      completedAt: status === "done" ? task.completedAt || now.toISOString() : "",
      updatedAt: now.toISOString(),
    };
    const action = status === "done" ? "完成任务" : status === "cancelled" ? "删除任务" : "修改任务";

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? updatedTask : item)),
      logs: [...current.logs, createLog(action, updatedTask, `状态变更为${getStatusMeta(status).label}`, now)],
    }));
  }

  async function startTask(task) {
    const action = normalizeLaunchAction(task.launchAction);
    const now = new Date();

    if (action.type === "none") {
      const updatedTask = {
        ...task,
        status: task.status === "done" ? task.status : "doing",
        updatedAt: now.toISOString(),
      };

      setData((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? updatedTask : item)),
        logs: [...current.logs, createLog("开始执行任务", updatedTask, "未配置执行动作，已标记为进行中", now)],
      }));

      notifyWithFallback({
        title: "已开始执行任务",
        body: `${task.title} · 未配置打开动作，已标记为进行中。`,
        sound: false,
        flash: false,
      });
      return;
    }

    const result = await launchAction(action);
    const detail = result?.ok
      ? `打开${launchActionTypes.find((item) => item.value === action.type)?.label || "执行动作"}：${action.target}`
      : `执行失败：${result?.message || "未知错误"}`;
    const updatedTask = result?.ok
      ? {
          ...task,
          status: task.status === "done" ? task.status : "doing",
          updatedAt: now.toISOString(),
        }
      : task;

    setData((current) => ({
      ...current,
      tasks: result?.ok ? current.tasks.map((item) => (item.id === task.id ? updatedTask : item)) : current.tasks,
      logs: [...current.logs, createLog(result?.ok ? "开始执行任务" : "修改任务", updatedTask, detail, now)],
    }));

    notifyWithFallback({
      title: result?.ok ? "已开始执行任务" : "执行动作失败",
      body: result?.ok ? task.title : detail,
      sound: false,
      flash: !result?.ok,
    });
  }

  function completeTaskOnce(task) {
    const now = new Date();
    const progressBefore = getDailyProgress(task, now);

    if (!progressBefore.isScheduled) {
      changeTaskStatus(task, "done");
      return;
    }

    const slot = progressBefore.slotStates.find((item) => item.isAvailable);

    if (!slot) {
      return;
    }

    const completionRecord = {
      id: `${task.id}_completion_${now.getTime()}`,
      completedAt: now.toISOString(),
      slot: slot.value,
    };
    const updatedRecords = [...(Array.isArray(task.completionRecords) ? task.completionRecords : []), completionRecord];
    const taskWithRecord = {
      ...task,
      completionRecords: updatedRecords,
    };
    const progress = getDailyProgress(taskWithRecord, now);
    const updatedTask = {
      ...taskWithRecord,
      status: task.status,
      updatedAt: now.toISOString(),
    };

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? updatedTask : item)),
      logs: [
        ...current.logs,
        createLog(
          progress.isReached ? "完成任务" : "修改任务",
          updatedTask,
          `${slot.label}完成，今日完成 ${progress.done}/${progress.target} 次，错过 ${progress.missed} 次`,
          now,
        ),
      ],
    }));
  }

  function deleteTask(task) {
    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id),
      logs: [...current.logs, createLog("删除任务", task, "从任务列表移除")],
    }));

    if (editingId === task.id) {
      resetDraft();
    }
  }

  function cancelDuplicateTasks(group) {
    const duplicateIds = new Set(group.duplicateTaskIds || []);

    if (duplicateIds.size === 0) {
      return;
    }

    const now = new Date();

    setData((current) => {
      const cancelledTasks = [];
      const tasks = current.tasks.map((task) => {
        if (!duplicateIds.has(task.id) || !isActiveTask(task)) {
          return task;
        }

        const updatedTask = {
          ...task,
          status: "cancelled",
          updatedAt: now.toISOString(),
        };
        cancelledTasks.push(updatedTask);
        return updatedTask;
      });

      if (cancelledTasks.length === 0) {
        return current;
      }

      return {
        ...current,
        tasks,
        logs: [
          ...current.logs,
          ...cancelledTasks.map((task) =>
            createLog("修改任务", task, `AI整理：与「${group.primaryTask.title}」重复，已标记为已取消`, now),
          ),
        ],
      };
    });
  }

  function mergeSimilarTasks(group) {
    const mergeIds = new Set(group.mergeTaskIds || []);

    if (mergeIds.size === 0) {
      return;
    }

    const now = new Date();

    setData((current) => {
      let primaryTask = null;
      const mergedTasks = [];
      const sourceTasks = current.tasks.filter((task) => mergeIds.has(task.id) && isActiveTask(task));

      if (sourceTasks.length === 0) {
        return current;
      }

      const sourceTaskNotes = sourceTasks
        .map((task) => `- ${task.title}${task.note ? `：${task.note}` : ""}`)
        .join("\n");
      const tasks = current.tasks.map((task) => {
        if (task.id === group.primaryTask.id) {
          const existingNote = String(task.note || "").trim();
          primaryTask = {
            ...task,
            note: [existingNote, `AI整理合并：\n${sourceTaskNotes}`].filter(Boolean).join("\n\n"),
            tags: Array.from(new Set([...(Array.isArray(task.tags) ? task.tags : []), "已整理"])),
            updatedAt: now.toISOString(),
          };
          return primaryTask;
        }

        if (mergeIds.has(task.id) && isActiveTask(task)) {
          const updatedTask = {
            ...task,
            status: "cancelled",
            updatedAt: now.toISOString(),
          };
          mergedTasks.push(updatedTask);
          return updatedTask;
        }

        return task;
      });

      if (!primaryTask || mergedTasks.length === 0) {
        return current;
      }

      return {
        ...current,
        tasks,
        logs: [
          ...current.logs,
          createLog("修改任务", primaryTask, `AI整理：合并 ${mergedTasks.length} 条相似任务到备注`, now),
          ...mergedTasks.map((task) =>
            createLog("修改任务", task, `AI整理：已合并到「${primaryTask.title}」并标记为已取消`, now),
          ),
        ],
      };
    });
  }

  function markStaleTask(taskSummary) {
    const now = new Date();

    setData((current) => {
      let updatedTask = null;
      const tasks = current.tasks.map((task) => {
        if (task.id !== taskSummary.id || !isActiveTask(task)) {
          return task;
        }

        updatedTask = {
          ...task,
          priority: "low",
          tags: Array.from(new Set([...(Array.isArray(task.tags) ? task.tags : []), "长期未完成"])),
          updatedAt: now.toISOString(),
        };
        return updatedTask;
      });

      if (!updatedTask) {
        return current;
      }

      return {
        ...current,
        tasks,
        logs: [...current.logs, createLog("修改任务", updatedTask, "AI整理：标记为长期未完成并降为低优先级", now)],
      };
    });
  }

  function detectWechatTasks() {
    const detected = detectCandidatesFromText(wechatText);

    if (detected.length === 0) {
      return;
    }

    setData((current) => ({
      ...current,
      candidates: [...detected, ...current.candidates],
    }));
    setWechatText("");
  }

  function confirmCandidate(candidate) {
    const task = createTask(candidateToDraft(candidate));

    setData((current) => ({
      ...current,
      tasks: [task, ...current.tasks],
      candidates: current.candidates.filter((item) => item.id !== candidate.id),
      logs: [...current.logs, createLog("创建任务", task, "候选任务确认入库")],
    }));
  }

  function dismissCandidate(candidate) {
    setData((current) => ({
      ...current,
      candidates: current.candidates.filter((item) => item.id !== candidate.id),
      logs: [...current.logs, createLog("删除任务", { title: candidate.text }, "候选任务忽略")],
    }));
  }

  function toggleSound() {
    setData((current) => ({
      ...current,
      settings: {
        ...current.settings,
        soundEnabled: !current.settings.soundEnabled,
      },
    }));
  }

  function updateAuthDraft(field, value) {
    setAuthDraft((current) => ({ ...current, [field]: value }));
  }

  function resetTurnstileToken() {
    setTurnstileToken("");
    setTurnstileResetKey((current) => current + 1);
  }

  const handleTurnstileError = useCallback((message) => {
    setTurnstileToken("");
    setAuthError(message);
  }, []);

  function switchAuthMode(nextMode) {
    setAuthMode(nextMode);
    setAuthError("");
    resetTurnstileToken();
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");

    if (turnstileSiteKey && !turnstileToken) {
      setAuthError("请先完成人类验证");
      return;
    }

    setIsAuthenticating(true);

    try {
      const credentials = {
        ...authDraft,
        turnstileToken,
      };
      const auth =
        authMode === "register" ? await registerAccount(credentials) : await loginAccount(credentials);

      setAccount(auth.user);
      setAuthDraft({ username: authDraft.username, password: "", displayName: authDraft.displayName });
      resetTurnstileToken();
      setData(initialData);
      setIsLoaded(false);
    } catch (error) {
      console.error(error);
      setAuthError(error.message || "登录失败，请稍后重试");
      resetTurnstileToken();
    } finally {
      setIsAuthenticating(false);
    }
  }

  async function handleLogout() {
    setAuthError("");

    try {
      await logoutAccount();
    } catch (error) {
      console.error(error);
    }

    setAccount(null);
    setData(initialData);
    setPasswordDraft({ currentPassword: "", nextPassword: "", confirmPassword: "" });
    setPasswordStatus({ type: "", message: "" });
    setIsLoaded(true);
  }

  function updatePasswordDraft(field, value) {
    setPasswordDraft((current) => ({ ...current, [field]: value }));
    setPasswordStatus({ type: "", message: "" });
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    setPasswordStatus({ type: "", message: "" });

    if (passwordDraft.nextPassword !== passwordDraft.confirmPassword) {
      setPasswordStatus({ type: "error", message: "两次输入的新密码不一致" });
      return;
    }

    if (passwordDraft.nextPassword.length < 6) {
      setPasswordStatus({ type: "error", message: "新密码至少需要 6 位" });
      return;
    }

    setIsPasswordSaving(true);

    try {
      const result = await changePassword(passwordDraft);
      setPasswordDraft({ currentPassword: "", nextPassword: "", confirmPassword: "" });
      setPasswordStatus({
        type: "success",
        message: `密码已更新，已退出其他设备 ${result?.signedOutSessions || 0} 个会话。`,
      });
    } catch (error) {
      console.error(error);

      if (isAuthRequiredError(error)) {
        setAccount(null);
        setAuthError(error.message || "请重新登录 Sherlly 账号");
        return;
      }

      setPasswordStatus({ type: "error", message: error.message || "修改密码失败，请稍后重试" });
    } finally {
      setIsPasswordSaving(false);
    }
  }

  if (cloudSyncEnabled && !account) {
    return (
      <AuthScreen
        draft={authDraft}
        error={authError}
        isSubmitting={isAuthenticating}
        mode={authMode}
        onModeChange={switchAuthMode}
        onSubmit={submitAuth}
        onTurnstileChange={setTurnstileToken}
        onTurnstileError={handleTurnstileError}
        onUpdate={updateAuthDraft}
        turnstileResetKey={turnstileResetKey}
        turnstileSiteKey={turnstileSiteKey}
        turnstileToken={turnstileToken}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Sherlly Assistant</p>
          <h1>工作事项闭环</h1>
        </div>
        <div className="topbar-actions">
          {account ? (
            <>
              <button className="account-chip" type="button" onClick={() => setActiveView("profile")} title="个人信息">
                <UserRound size={16} />
                <span>{account.displayName || account.username}</span>
              </button>
              <button className="icon-button" type="button" onClick={handleLogout} title="退出登录">
                <LogOut size={18} />
              </button>
            </>
          ) : null}
          <button className="icon-button" type="button" onClick={toggleSound} title="切换声音提醒">
            {data.settings.soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button className="primary-button" type="button" onClick={() => activateQuickCapture("手动录入")}>
            <Plus size={18} />
            <span>新任务</span>
            <kbd>Ctrl+Alt+S</kbd>
          </button>
        </div>
      </header>

      {syncError ? (
        <section className="sync-error-banner" role="alert">
          {syncError}
        </section>
      ) : null}

      {shouldShowUpdateStatus(updateStatus, dismissedUpdateKey) ? (
        <UpdateBanner
          isBusy={isUpdateActionPending}
          onDismiss={dismissUpdateBanner}
          onDownload={downloadAndInstallUpdate}
          onRetry={retryUpdateCheck}
          status={updateStatus}
        />
      ) : null}

      {reminderAlerts.length > 0 ? (
        <section className="reminder-alerts" aria-label="提醒消息" aria-live="polite" role="status">
          {reminderAlerts.map((alert) => (
            <article className="reminder-alert" key={alert.id}>
              <Bell size={18} />
              <div>
                <strong>{alert.title}</strong>
                <p>{alert.body}</p>
                <span>{formatDateTime(alert.createdAt)}</span>
              </div>
              <button className="icon-button" type="button" onClick={() => dismissReminderAlert(alert.id)} title="关闭提醒">
                <X size={16} />
              </button>
            </article>
          ))}
        </section>
      ) : null}

      <MobileHomePanel
        captureStatus={mobileCaptureStatus}
        isVoiceListening={isVoiceListening}
        now={currentTime}
        onAddToCalendar={downloadTaskCalendar}
        onCompleteTask={completeMobileTask}
        onOpenFullBoard={() => setActiveView("tasks")}
        onQuickTextChange={setMobileQuickText}
        onStartTask={startTask}
        onStartVoice={startMobileVoiceCapture}
        onSubmitQuickTask={submitMobileQuickTask}
        onViewTask={(task) => setDetailTaskId(task.id)}
        quickText={mobileQuickText}
        tasks={mobileFocusTasks}
      />

      <section className="metrics-grid" aria-label="任务概览">
        <Metric icon={<ListChecks size={20} />} label="未完成" value={taskStats.active} />
        <Metric icon={<Bell size={20} />} label="已逾期" value={taskStats.overdue} tone="danger" />
        <Metric icon={<Clock3 size={20} />} label="等待他人" value={taskStats.waiting} />
        <Metric icon={<CheckCircle2 size={20} />} label="已完成" value={taskStats.done} tone="success" />
      </section>

      <section className="view-switcher" aria-label="主入口">
        {viewOptions.map((option) => (
          <button
            key={option.value}
            className={activeView === option.value ? "is-active" : ""}
            type="button"
            onClick={() => setActiveView(option.value)}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </section>

      <div className={`workspace-grid ${["profile", "vault", "memory"].includes(activeView) ? "profile-grid" : ""}`}>
        <section
          className="task-area"
          aria-label={
            activeView === "tasks"
              ? "任务列表"
              : activeView === "profile"
                ? "个人信息"
                : activeView === "vault"
                  ? "安全速记"
                  : activeView === "assistant"
                    ? "AI工作台"
                    : activeView === "memory"
                      ? "长期记忆"
                      : "工作日报"
          }
        >
          {activeView === "tasks" ? (
            <>
              <div className="section-toolbar">
                <div>
                  <p className="eyebrow">Task Board</p>
                  <h2>任务管理</h2>
                </div>
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="search"
                    placeholder="搜索标题、负责人、标签"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <button
                    className="icon-button"
                    type="button"
                    onClick={handleRefresh}
                    title="刷新页面"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              <div className="segmented-control" aria-label="任务筛选">
                <Filter size={16} />
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={taskFilter === option.value ? "is-active" : ""}
                    type="button"
                    onClick={() => setTaskFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="task-list">
                {filteredTasks.length === 0 ? (
                  <EmptyState icon={<Inbox size={24} />} text="当前筛选下没有任务" />
                ) : (
                  filteredTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onCopy={copyTask}
                      onEdit={editTask}
                      onStatusChange={changeTaskStatus}
                      onStart={startTask}
                      onCompleteOnce={completeTaskOnce}
                      onPreviewAttachment={previewAttachment}
                      onDelete={deleteTask}
                      now={currentTime}
                    />
                  ))
                )}
              </div>
            </>
          ) : activeView === "profile" ? (
            <ProfilePanel
              account={account}
              draft={passwordDraft}
              isSubmitting={isPasswordSaving}
              onSubmit={submitPasswordChange}
              onUpdate={updatePasswordDraft}
              status={passwordStatus}
            />
          ) : activeView === "vault" ? (
            <VaultPanel
              categoryFilter={vaultCategoryFilter}
              cryptoSupported={hasVaultCryptoSupport()}
              draft={vaultDraft}
              editingId={vaultEditingId}
              ftpClientPath={String(data.settings?.ftpClientPath ?? DEFAULT_FTP_CLIENT_PATH)}
              items={filteredVaultItems}
              masterPassword={vaultMasterPassword}
              onCancelEdit={resetVaultDraft}
              onCategoryFilterChange={setVaultCategoryFilter}
              onCopyValue={copyVaultValue}
              onDeleteItem={deleteVaultItem}
              onEditItem={editVaultItem}
              onFtpClientPathChange={updateVaultFtpClientPath}
              onLockItem={lockVaultItem}
              onMasterPasswordChange={setVaultMasterPassword}
              onOpenTarget={openVaultTarget}
              onSearchChange={setVaultSearchQuery}
              onSubmit={submitVaultItem}
              onUnlockItem={unlockVaultItem}
              onUpdateDraft={updateVaultDraft}
              searchQuery={vaultSearchQuery}
              stats={vaultStats}
              status={vaultStatus}
              unlockedItems={vaultUnlockedItems}
            />
          ) : activeView === "assistant" ? (
            <AiWorkspacePanel
              answer={aiWorkspaceAnswer}
              draftQuestion={assistantDraftQuestion}
              onAskPreset={askAssistant}
              onPreviewAttachment={previewAttachment}
              onQuestionChange={setAssistantDraftQuestion}
              onSubmitQuestion={askAssistant}
              onViewTask={(task) => setDetailTaskId(task.id)}
              question={assistantQuestion}
            />
          ) : activeView === "memory" ? (
            <WorkMemoryPanel
              memory={workMemoryLibrary}
              onViewTask={(task) => setDetailTaskId(task.id)}
            />
          ) : (
            <ReportPanel
              dailyReport={dailyReport}
              logRange={logRange}
              onCancelDuplicateTasks={cancelDuplicateTasks}
              onMarkStaleTask={markStaleTask}
              onMergeSimilarTasks={mergeSimilarTasks}
              onLogRangeChange={setLogRange}
              onPreviewAttachment={previewAttachment}
              onViewTask={(task) => setDetailTaskId(task.id)}
              organizingSuggestions={organizingSuggestions}
              visibleLogs={visibleLogs}
            />
          )}
        </section>

        {["profile", "vault", "memory"].includes(activeView) ? null : (
        <aside className="side-rail" aria-label="录入与候选任务">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Capture</p>
                <h2>{editingId ? "编辑任务" : "任务录入"}</h2>
              </div>
              {editingId ? (
                <button className="icon-button" type="button" onClick={resetDraft} title="取消编辑">
                  <X size={18} />
                </button>
              ) : null}
            </div>

            <div className="capture-action-bar" aria-label="任务快捷操作">
              <button className="secondary-button" type="button" onClick={addDraftAttachments} title="添加图片或文件">
                <Paperclip size={17} />
                <span>附件</span>
              </button>
              <button className="secondary-button" type="button" onClick={pasteClipboardImages} title="粘贴图片">
                <ClipboardList size={17} />
                <span>粘贴图片</span>
              </button>
              <button className="primary-button" type="submit" form="task-form">
                <Save size={17} />
                <span>{editingId ? "保存" : "创建"}</span>
              </button>
            </div>

            <div
              className={`drop-capture ${isDraggingText ? "is-active" : ""}`}
              onDragLeave={handleTextDragLeave}
              onDragOver={handleTextDragOver}
              onDrop={handleTextDrop}
            >
              <ClipboardList size={20} />
              <div>
                <strong>拖拽文本创建任务</strong>
                <span>把微信文字拖到这里，Sherlly 会创建任务并把原文放进备注。</span>
              </div>
            </div>

            <form className="task-form" id="task-form" onPaste={handleTaskFormPaste} onSubmit={submitTask}>
              <label>
                标题
                <input
                  id="task-title"
                  ref={titleInputRef}
                  value={draft.title}
                  onChange={(event) => updateDraft("title", event.target.value)}
                  placeholder="例如：周五前发报价给王总"
                />
              </label>

              <div className="form-grid">
                <label>
                  来源
                  <select value={draft.source} onChange={(event) => updateDraft("source", event.target.value)}>
                    {withCurrentOption(sourceOptions, draft.source).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  负责人
                  <select value={draft.owner} onChange={(event) => updateDraft("owner", event.target.value)}>
                    <option value="">请选择负责人</option>
                    {withCurrentOption(ownerOptions, draft.owner).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                截止时间
                <input
                  type="datetime-local"
                  value={draft.dueAt}
                  onChange={(event) => updateDraft("dueAt", event.target.value)}
                />
              </label>

              <fieldset className="reminder-window-fieldset">
                <legend>预定提醒（可选）</legend>
                <div className="form-grid">
                  <label>
                    开始
                    <input
                      type="datetime-local"
                      value={draft.reminderStartAt}
                      onChange={(event) => updateDraft("reminderStartAt", event.target.value)}
                    />
                  </label>
                  <label>
                    结束
                    <input
                      type="datetime-local"
                      value={draft.reminderEndAt}
                      onChange={(event) => updateDraft("reminderEndAt", event.target.value)}
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="slot-fieldset">
                <legend>每日时段（可选）</legend>
                <div className="slot-options">
                  <label className="slot-option" key="regular-plan">
                    <input
                      type="checkbox"
                      checked={selectedDraftSlots.length === 0}
                      onChange={clearDraftSlots}
                    />
                    <span>常规计划</span>
                  </label>
                  {dailySlots.map((slot) => {
                    return (
                      <label className="slot-option" key={slot.value}>
                        <input
                          type="checkbox"
                          checked={selectedDraftSlots.includes(slot.value)}
                          onChange={() => toggleDraftSlot(slot.value)}
                        />
                        <span>{slot.label}</span>
                      </label>
                    );
                  })}
                </div>
                <p>
                  {selectedDraftSlots.length === 0
                    ? "常规计划不显示今日进度，也不会产生错过时段。"
                    : `已选 ${selectedDraftSlots.length} 次/天；错过某个时段后不会自动补到其他时段。`}
                </p>
              </fieldset>

              <fieldset className="action-fieldset">
                <legend>执行动作</legend>
                <div className="form-grid">
                  <label>
                    类型
                    <select
                      value={draft.launchAction.type}
                      onChange={(event) => updateDraftLaunchAction("type", event.target.value)}
                    >
                      {launchActionTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    目标
                    <input
                      value={draft.launchAction.target}
                      onChange={(event) => updateDraftLaunchAction("target", event.target.value)}
                      placeholder="网址 / 文件夹路径 / code 命令"
                    />
                  </label>
                </div>
                <p>VSCode 项目填写项目目录，例如 E:\项目\秘书；如果 code 命令不可用，会尝试用系统默认方式打开。</p>
              </fieldset>

              <div className="form-grid">
                <label>
                  优先级
                  <select value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value)}>
                    {priorities.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label} · {priority.reminderMinutes}分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select value={draft.status} onChange={(event) => updateDraft("status", event.target.value)}>
                    {taskStatuses.map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                标签
                <input
                  value={draft.tags}
                  onChange={(event) => updateDraft("tags", event.target.value)}
                  placeholder="客户A 报价 合同"
                />
              </label>

              <label>
                备注
                <textarea
                  value={draft.note}
                  onChange={(event) => updateDraft("note", event.target.value)}
                  rows={3}
                  placeholder="粘贴原始上下文或补充说明"
                />
              </label>

              <fieldset className="attachment-fieldset">
                <legend>附件</legend>
                <div className="attachment-actions">
                  <button className="secondary-button full-width" type="button" onClick={addDraftAttachments}>
                    <Paperclip size={18} />
                    添加图片或文件
                  </button>
                  <button className="secondary-button full-width" type="button" onClick={pasteClipboardImages}>
                    <ClipboardList size={18} />
                    粘贴图片
                  </button>
                </div>
                {draftAttachments.length === 0 ? (
                  <p>暂无附件；桌面端会保存本机文件路径，粘贴图片会随任务一起保存。</p>
                ) : (
                  <div className="attachment-list">
                    {draftAttachments.map((attachment) => (
                      <article className="attachment-item" key={attachment.id}>
                        {attachment.type === "image" && attachment.path.startsWith("data:image/") ? (
                          <img className="attachment-thumb" src={attachment.path} alt="" />
                        ) : (
                          <Paperclip size={16} />
                        )}
                        <div>
                          <strong>{attachment.name}</strong>
                          <span>{attachment.type === "image" ? "图片" : "文件"}</span>
                        </div>
                        <div className="attachment-item-actions">
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => previewAttachment(attachment)}
                            title="预览附件"
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-button danger"
                            type="button"
                            onClick={() => removeDraftAttachment(attachment.id)}
                            title="移除附件"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </fieldset>
            </form>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">WeChat Intake</p>
                <h2>候选任务池</h2>
              </div>
              <MessageSquareText size={20} />
            </div>

            <textarea
              className="wechat-input"
              value={wechatText}
              onChange={(event) => setWechatText(event.target.value)}
              rows={4}
              placeholder="粘贴微信内容，Sherlly 会挑出疑似待办"
            />
            <button className="secondary-button full-width" type="button" onClick={detectWechatTasks}>
              <ClipboardList size={18} />
              识别待办
            </button>

            <div className="candidate-list">
              {data.candidates.length === 0 ? (
                <EmptyState icon={<Megaphone size={22} />} text="暂无候选事项" />
              ) : (
                data.candidates.map((candidate) => (
                  <article className="candidate-item" key={candidate.id}>
                    <p>{candidate.text}</p>
                    <span>{formatDateTime(candidate.detectedAt)}</span>
                    <div className="candidate-actions">
                      <button type="button" onClick={() => confirmCandidate(candidate)}>
                        确认入库
                      </button>
                      <button type="button" onClick={() => dismissCandidate(candidate)}>
                        忽略
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

        </aside>
        )}
      </div>

      {detailTask ? (
        <TaskDetailDialog
          task={detailTask}
          onClose={() => setDetailTaskId("")}
          onEdit={(task) => {
            setDetailTaskId("");
            editTask(task);
          }}
          onCopy={(task) => {
            setDetailTaskId("");
            copyTask(task);
          }}
          onAddToCalendar={downloadTaskCalendar}
          onPreviewAttachment={previewAttachment}
          now={currentTime}
        />
      ) : null}

      {attachmentPreview ? (
        <AttachmentPreviewDialog
          preview={attachmentPreview}
          onClose={() => setAttachmentPreview(null)}
          onOpen={openTaskAttachment}
        />
      ) : null}
    </main>
  );
}

function ProfilePanel({ account, draft, isSubmitting, onSubmit, onUpdate, status }) {
  return (
    <div className="profile-panel">
      <div className="section-toolbar profile-toolbar">
        <div>
          <p className="eyebrow">Account</p>
          <h2>个人信息</h2>
        </div>
        <UserRound size={20} />
      </div>

      <div className="profile-grid-inner">
        <section className="profile-card">
          <strong>账号资料</strong>
          <dl className="account-details">
            <div>
              <dt>昵称</dt>
              <dd>{account?.displayName || account?.username || "未设置"}</dd>
            </div>
            <div>
              <dt>账号</dt>
              <dd>{account?.username || "未登录"}</dd>
            </div>
            <div>
              <dt>用户 ID</dt>
              <dd>{account?.id || "-"}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-card">
          <strong>修改密码</strong>
          <form className="password-form" onSubmit={onSubmit}>
            <label>
              当前密码
              <input
                autoComplete="current-password"
                type="password"
                value={draft.currentPassword}
                onChange={(event) => onUpdate("currentPassword", event.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                autoComplete="new-password"
                type="password"
                value={draft.nextPassword}
                onChange={(event) => onUpdate("nextPassword", event.target.value)}
                placeholder="至少 6 位"
              />
            </label>
            <label>
              确认新密码
              <input
                autoComplete="new-password"
                type="password"
                value={draft.confirmPassword}
                onChange={(event) => onUpdate("confirmPassword", event.target.value)}
              />
            </label>

            {status?.message ? (
              <p className={`profile-message ${status.type === "success" ? "is-success" : "is-error"}`} role="alert">
                {status.message}
              </p>
            ) : null}

            <button className="primary-button" type="submit" disabled={isSubmitting}>
              <KeyRound size={18} />
              {isSubmitting ? "保存中" : "保存新密码"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

function VaultPanel({
  categoryFilter,
  cryptoSupported,
  draft,
  editingId,
  ftpClientPath,
  items,
  masterPassword,
  onCancelEdit,
  onCategoryFilterChange,
  onCopyValue,
  onDeleteItem,
  onEditItem,
  onFtpClientPathChange,
  onLockItem,
  onMasterPasswordChange,
  onOpenTarget,
  onSearchChange,
  onSubmit,
  onUnlockItem,
  onUpdateDraft,
  searchQuery,
  stats,
  status,
  unlockedItems,
}) {
  return (
    <div className="vault-panel">
      <div className="section-toolbar vault-toolbar">
        <div>
          <p className="eyebrow">Secure Notes</p>
          <h2>安全速记</h2>
        </div>
        <ShieldCheck size={20} />
      </div>

      <section className="vault-guard">
        <div>
          <strong>保险箱主密码</strong>
          <p>主密码只用于本次加密/解锁，不会保存到本地或云端。忘记后无法解密旧内容。</p>
        </div>
        <div className="vault-guard-fields">
          <label>
            主密码
            <input
              type="password"
              value={masterPassword}
              onChange={(event) => onMasterPasswordChange(event.target.value)}
              placeholder="至少 6 位，用来加密和解锁"
            />
          </label>
          <label>
            FTP 客户端路径
            <input
              value={ftpClientPath}
              onChange={(event) => onFtpClientPathChange(event.target.value)}
              placeholder={DEFAULT_FTP_CLIENT_PATH}
            />
          </label>
        </div>
      </section>

      {!cryptoSupported ? (
        <p className="profile-message is-error">当前环境不支持 Web Crypto，暂时不能使用安全速记。</p>
      ) : null}

      {status.message ? (
        <p className={`profile-message vault-message is-${status.type || "success"}`} role="alert" aria-live="polite">
          {status.message}
        </p>
      ) : null}

      <div className="vault-grid">
        <section className="vault-card">
          <div className="vault-card-heading">
            <strong>{editingId ? "编辑安全速记" : "新增安全速记"}</strong>
            {editingId ? (
              <button className="icon-button" type="button" onClick={onCancelEdit} title="取消编辑">
                <X size={17} />
              </button>
            ) : null}
          </div>

          <form className="vault-form" onSubmit={onSubmit}>
            <div className="form-grid">
              <label>
                标题
                <input
                  value={draft.title}
                  onChange={(event) => onUpdateDraft("title", event.target.value)}
                  placeholder="例如：客户报价系统"
                />
              </label>
              <label>
                分类
                <select value={draft.category} onChange={(event) => onUpdateDraft("category", event.target.value)}>
                  {vaultCategories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-grid">
              <label>
                账号
                <input
                  value={draft.username}
                  onChange={(event) => onUpdateDraft("username", event.target.value)}
                  placeholder="用户名 / 邮箱 / 手机号"
                />
              </label>
              <label>
                密码 / Token
                <input
                  type="password"
                  value={draft.password}
                  onChange={(event) => onUpdateDraft("password", event.target.value)}
                  placeholder="保存时会加密"
                />
              </label>
            </div>

            <label>
              网址
              <input
                value={draft.url}
                onChange={(event) => onUpdateDraft("url", event.target.value)}
                placeholder="https://example.com"
              />
            </label>

            <label>
              标签
              <input
                value={draft.tags}
                onChange={(event) => onUpdateDraft("tags", event.target.value)}
                placeholder="客户 财务 常用"
              />
            </label>

            <label>
              备注
              <textarea
                value={draft.note}
                onChange={(event) => onUpdateDraft("note", event.target.value)}
                rows={3}
                placeholder="只写必要说明，保存后会加密"
              />
            </label>

            <button className="primary-button" type="submit" disabled={!cryptoSupported}>
              <Save size={17} />
              {editingId ? "重新加密保存" : "加密保存"}
            </button>
          </form>
        </section>

        <section className="vault-card">
          <div className="vault-card-heading">
            <strong>保险箱列表</strong>
            <span>
              {stats.total} 条 · 已解锁 {stats.unlocked}
            </span>
          </div>

          <div className="vault-filters">
            <label>
              搜索
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="标题、账号、标签"
              />
            </label>
            <label>
              分类
              <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)}>
                <option value="all">全部分类</option>
                {vaultCategories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="vault-list">
            {items.length === 0 ? (
              <EmptyState icon={<ShieldCheck size={22} />} text="还没有安全速记" />
            ) : (
              items.map((item) => (
                <VaultItemCard
                  item={item}
                  key={item.id}
                  onCopyValue={onCopyValue}
                  onDeleteItem={onDeleteItem}
                  onEditItem={onEditItem}
                  onLockItem={onLockItem}
                  onOpenTarget={onOpenTarget}
                  onUnlockItem={onUnlockItem}
                  unlocked={unlockedItems[item.id]}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function VaultItemCard({ item, onCopyValue, onDeleteItem, onEditItem, onLockItem, onOpenTarget, onUnlockItem, unlocked }) {
  const category = vaultCategories.find((option) => option.value === item.category) || vaultCategories[vaultCategories.length - 1];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const hasOpenTarget = Boolean(unlocked && (unlocked.url || item.category === "ftp"));
  const openButtonLabel = isFtpVaultTarget(item, unlocked?.url) ? "打开 FTP" : "打开网址";

  return (
    <article className="vault-item">
      <div className="vault-item-heading">
        <div>
          <strong>{item.title}</strong>
          <span>{category.label}</span>
        </div>
        <button className="secondary-button" type="button" onClick={() => (unlocked ? onLockItem(item.id) : onUnlockItem(item))}>
          <ShieldCheck size={15} />
          {unlocked ? "隐藏" : "解锁"}
        </button>
      </div>

      <dl className="vault-fields">
        <div>
          <dt>账号</dt>
          <dd>{unlocked?.username || item.usernameHint || "未填写"}</dd>
        </div>
        <div>
          <dt>密码</dt>
          <dd>{unlocked?.password ? maskSecretValue(unlocked.password, 0, 0) : "已加密"}</dd>
        </div>
        {unlocked?.url ? (
          <div>
            <dt>网址</dt>
            <dd>{unlocked.url}</dd>
          </div>
        ) : null}
        {unlocked?.note ? (
          <div>
            <dt>备注</dt>
            <dd>{unlocked.note}</dd>
          </div>
        ) : null}
      </dl>

      {tags.length > 0 ? (
        <div className="tag-list">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="vault-item-actions">
        <button type="button" onClick={() => onCopyValue(item, "username", "账号")} disabled={!unlocked}>
          复制账号
        </button>
        <button type="button" onClick={() => onCopyValue(item, "password", "密码")} disabled={!unlocked}>
          复制密码
        </button>
        {hasOpenTarget ? (
          <button type="button" onClick={() => onOpenTarget(item)}>
            <ExternalLink size={15} />
            {openButtonLabel}
          </button>
        ) : null}
        <button type="button" onClick={() => onEditItem(item)}>
          编辑
        </button>
        <button className="danger" type="button" onClick={() => onDeleteItem(item)}>
          删除
        </button>
      </div>
    </article>
  );
}

function WorkMemoryPanel({ memory, onViewTask }) {
  const metrics = [
    { label: "任务样本", value: memory.metrics?.taskSamples || 0 },
    { label: "联系人", value: memory.metrics?.contacts || 0 },
    { label: "排期规律", value: memory.metrics?.schedulePatterns || 0 },
    { label: "项目", value: memory.metrics?.projects || 0 },
  ];

  return (
    <div className="memory-panel">
      <div className="section-toolbar memory-toolbar">
        <div>
          <p className="eyebrow">Long Memory</p>
          <h2>长期记忆</h2>
        </div>
        <Wand2 size={20} />
      </div>

      <section className="ai-answer-card memory-summary">
        <div className="ai-answer-heading">
          <div>
            <span>工作习惯库</span>
            <strong>联系人、项目和排期规律</strong>
          </div>
          <em>{formatDateTime(memory.generatedAt)}</em>
        </div>
        <p>从历史任务里沉淀可复用线索，帮助判断谁需要提前确认、哪些项目当前积压、哪些事项容易集中在固定日期。</p>
        <div className="report-metrics memory-metrics">
          {metrics.map((metric) => (
            <span key={metric.label}>
              {metric.label} {metric.value}
            </span>
          ))}
        </div>
      </section>

      <div className="memory-grid">
        <MemoryStatsSection
          emptyText="暂无联系人习惯"
          items={memory.contacts || []}
          onViewTask={onViewTask}
          title="联系人习惯"
        />
        <MemoryPatternSection
          items={memory.schedulePatterns || []}
          onViewTask={onViewTask}
        />
        <MemoryStatsSection
          emptyText="暂无项目记忆"
          items={memory.projects || []}
          onViewTask={onViewTask}
          title="项目记忆"
        />
      </div>
    </div>
  );
}

function MemoryStatsSection({ emptyText, items, onViewTask, title }) {
  return (
    <article className="report-section memory-section">
      <strong>{title}</strong>
      {items.length === 0 ? (
        <EmptyState icon={<Wand2 size={22} />} text={emptyText} />
      ) : (
        <div className="memory-list">
          {items.map((item) => (
            <section className="memory-card" key={item.name}>
              <div className="memory-card-heading">
                <strong>{item.name}</strong>
                <span>{item.total} 件</span>
              </div>
              <div className="memory-meta">
                <span>未完成 {item.active}</span>
                <span>完成 {item.completed}</span>
                <span>等待 {item.waiting}</span>
                <span>逾期 {item.overdue}</span>
                <span>高优先级 {item.high}</span>
                {item.latestAt ? <span>最近 {formatDateTime(item.latestAt)}</span> : null}
              </div>
              <MemoryTaskList tasks={item.tasks || []} onViewTask={onViewTask} />
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function MemoryPatternSection({ items, onViewTask }) {
  return (
    <article className="report-section memory-section">
      <strong>排期规律</strong>
      {items.length === 0 ? (
        <EmptyState icon={<CalendarClock size={22} />} text="暂无稳定排期规律" />
      ) : (
        <div className="memory-list">
          {items.map((item) => (
            <section className="memory-card" key={item.title}>
              <div className="memory-card-heading">
                <strong>{item.title}</strong>
                <span>{item.total} 次</span>
              </div>
              <p>{item.detail}</p>
              <MemoryTaskList tasks={item.tasks || []} onViewTask={onViewTask} />
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function MemoryTaskList({ onViewTask, tasks }) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="organizing-task-list memory-task-list">
      {tasks.map((task) => (
        <OrganizingTaskButton key={task.id} onViewTask={onViewTask} task={task} />
      ))}
    </div>
  );
}
function AiWorkspacePanel({
  answer,
  draftQuestion,
  onAskPreset,
  onPreviewAttachment,
  onQuestionChange,
  onSubmitQuestion,
  onViewTask,
  question,
}) {
  const metrics = [
    answer.metrics?.matched != null ? { label: "相关", value: answer.metrics.matched } : null,
    { label: "未完成", value: answer.metrics?.active || 0 },
    { label: "逾期", value: answer.metrics?.overdue || 0 },
    { label: "等待他人", value: answer.metrics?.waiting || 0 },
    { label: "已完成", value: answer.metrics?.completed || 0 },
  ].filter(Boolean);
  const hasDraftChanges = draftQuestion.trim() !== question.trim();
  const answerTips = Array.isArray(answer.tips) ? answer.tips : [];
  const answerKeywords = Array.isArray(answer.keywords) ? answer.keywords : [];

  function handleSubmit(event) {
    event.preventDefault();
    onSubmitQuestion(draftQuestion);
  }

  return (
    <div className="ai-workspace-panel">
      <div className="section-toolbar ai-workspace-toolbar">
        <div>
          <p className="eyebrow">AI Workspace</p>
          <h2>AI工作台</h2>
        </div>
        <MessageSquareText size={20} />
      </div>

      <form className="ai-question-box" onSubmit={handleSubmit}>
        <MessageSquareText size={18} />
        <input
          aria-label="AI工作台问题"
          value={draftQuestion}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder="直接问：现在先做什么、合同进展如何、有哪些风险"
        />
        <button className="primary-button" type="submit">
          <Search size={16} />
          {hasDraftChanges ? "重新分析" : "分析"}
        </button>
      </form>

      <div className="ai-presets" aria-label="常用问题">
        {assistantQuestionPresets.map((preset) => (
          <button
            className={preset === question && !hasDraftChanges ? "is-active" : ""}
            key={preset}
            type="button"
            onClick={() => onAskPreset(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      <section className="ai-answer-card">
        <div className="ai-answer-heading">
          <div>
            <span>{answer.label}</span>
            <strong>{answer.title}</strong>
          </div>
          <em>{formatDateTime(answer.generatedAt)}</em>
        </div>
        <div className="ai-answer-context" aria-label="AI工作台解析依据">
          <span>按“{answer.usedQuery || question}”分析</span>
          {hasDraftChanges ? <span className="is-pending">输入已修改，点重新分析更新结果</span> : null}
          {answerKeywords.map((keyword) => (
            <span key={keyword}>识别：{keyword}</span>
          ))}
          {answer.isFallback ? <span className="is-warning">未识别明确对象</span> : null}
        </div>
        <p>{answer.summary}</p>
        {answerTips.length > 0 ? (
          <div className="ai-answer-tips">
            {answerTips.map((tip) => (
              <span key={tip}>{tip}</span>
            ))}
          </div>
        ) : null}
        <div className="report-metrics">
          {metrics.map((metric) => (
            <span key={metric.label}>
              {metric.label} {metric.value}
            </span>
          ))}
        </div>
      </section>

      <div className="ai-workspace-grid">
        <article className="report-section">
          <strong>{answer.taskSectionTitle}</strong>
          <ReportTaskList
            emptyText="没有匹配到任务。"
            onPreviewAttachment={onPreviewAttachment}
            onViewTask={onViewTask}
            tasks={answer.primaryTasks || []}
          />
        </article>

        <AiProjectGroups groups={answer.projectGroups || []} onViewTask={onViewTask} />
      </div>

      <div className="ai-workspace-grid secondary">
        <AiMemoryHints hints={answer.memoryHints || []} />
        <AiRecentLogs logs={answer.recentLogs || []} />
      </div>
    </div>
  );
}

function AiProjectGroups({ groups, onViewTask }) {
  return (
    <article className="report-section">
      <strong>项目归类</strong>
      {groups.length === 0 ? (
        <EmptyState icon={<ClipboardList size={22} />} text="暂无可归类项目" />
      ) : (
        <div className="ai-project-list">
          {groups.map((group) => (
            <section className="ai-project-group" key={group.name}>
              <div className="ai-project-heading">
                <strong>{group.name}</strong>
                <span>{group.total} 件</span>
              </div>
              <div className="ai-project-meta">
                <span>高优先级 {group.high}</span>
                <span>逾期 {group.overdue}</span>
                <span>等待 {group.waiting}</span>
              </div>
              <div className="organizing-task-list">
                {group.tasks.map((task) => (
                  <OrganizingTaskButton key={task.id} onViewTask={onViewTask} task={task} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function AiMemoryHints({ hints }) {
  return (
    <article className="report-section">
      <strong>工作记忆</strong>
      {hints.length === 0 ? (
        <EmptyState icon={<Wand2 size={22} />} text="暂无稳定记忆线索" />
      ) : (
        <div className="ai-memory-list">
          {hints.map((hint) => (
            <section className="ai-memory-item" key={`${hint.title}:${hint.detail}`}>
              <strong>{hint.title}</strong>
              <p>{hint.detail}</p>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

function AiRecentLogs({ logs }) {
  return (
    <article className="report-section">
      <strong>最近日志</strong>
      {logs.length === 0 ? (
        <EmptyState icon={<FileText size={22} />} text="没有匹配日志" />
      ) : (
        <div className="log-list compact">
          {logs.map((log) => (
            <article className="log-item" key={log.id}>
              <strong>{log.action}</strong>
              <span>{formatDateTime(log.createdAt)}</span>
              <p>{log.taskTitle || log.detail}</p>
            </article>
          ))}
        </div>
      )}
    </article>
  );
}

function AuthScreen({
  draft,
  error,
  isSubmitting,
  mode,
  onModeChange,
  onSubmit,
  onTurnstileChange,
  onTurnstileError,
  onUpdate,
  turnstileResetKey,
  turnstileSiteKey,
  turnstileToken,
}) {
  const isRegister = mode === "register";
  const requiresTurnstile = Boolean(turnstileSiteKey);

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-label="Sherlly 账号登录">
        <div className="auth-heading">
          <div>
            <p className="eyebrow">Sherlly Assistant</p>
            <h1>{isRegister ? "创建账号" : "账号登录"}</h1>
          </div>
          <UserRound size={22} />
        </div>

        <div className="segmented-control compact auth-mode" aria-label="登录模式">
          <button
            className={!isRegister ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("login")}
          >
            登录
          </button>
          <button
            className={isRegister ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("register")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            账号
            <input
              autoComplete="username"
              autoFocus
              value={draft.username}
              onChange={(event) => onUpdate("username", event.target.value)}
              placeholder="例如 sherlly"
            />
          </label>

          {isRegister ? (
            <label>
              昵称
              <input
                autoComplete="name"
                value={draft.displayName}
                onChange={(event) => onUpdate("displayName", event.target.value)}
                placeholder="Sherlly"
              />
            </label>
          ) : null}

          <label>
            密码
            <input
              autoComplete={isRegister ? "new-password" : "current-password"}
              type="password"
              value={draft.password}
              onChange={(event) => onUpdate("password", event.target.value)}
              placeholder="至少 6 位"
            />
          </label>

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          {requiresTurnstile ? (
            <TurnstileChallenge
              disabled={isSubmitting}
              onError={onTurnstileError}
              onTokenChange={onTurnstileChange}
              resetKey={turnstileResetKey}
              siteKey={turnstileSiteKey}
            />
          ) : null}

          <button className="primary-button full-width" type="submit" disabled={isSubmitting || (requiresTurnstile && !turnstileToken)}>
            <LogIn size={18} />
            {isSubmitting ? "处理中" : isRegister ? "注册并登录" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function TurnstileChallenge({ disabled, onError, onTokenChange, resetKey, siteKey }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef("");

  useEffect(() => {
    let isCancelled = false;
    let retryTimer = 0;

    function clearWidget() {
      if (widgetIdRef.current && window.turnstile?.remove) {
        window.turnstile.remove(widgetIdRef.current);
      }

      widgetIdRef.current = "";
    }

    function renderWidget() {
      if (isCancelled || !containerRef.current) {
        return;
      }

      if (!window.turnstile?.render) {
        retryTimer = window.setTimeout(renderWidget, 160);
        return;
      }

      clearWidget();
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "login",
        callback(token) {
          onTokenChange(token);
        },
        "expired-callback"() {
          onTokenChange("");
          onError("人类验证已过期，请重新验证");
        },
        "error-callback"() {
          onTokenChange("");
          onError("人类验证加载失败，请稍后重试");
        },
      });
    }

    onTokenChange("");
    renderWidget();

    return () => {
      isCancelled = true;
      window.clearTimeout(retryTimer);
      clearWidget();
    };
  }, [onError, onTokenChange, resetKey, siteKey]);

  return (
    <div className="turnstile-field" aria-busy={disabled ? "true" : "false"}>
      <div ref={containerRef} />
    </div>
  );
}

function UpdateBanner({ isBusy, onDismiss, onDownload, onRetry, status }) {
  const latestVersion = status.latestVersion ? ` ${status.latestVersion}` : "";
  const isDownloading = status.state === "downloading";
  const isInstalling = status.state === "installing";
  const isError = status.state === "error";
  const isDownloaded = status.state === "downloaded";
  const canDismiss = !isDownloading && !isInstalling;
  const title = isError
    ? "自动更新检查失败"
    : isInstalling
      ? "正在安装更新"
      : isDownloading
        ? "正在下载更新"
        : isDownloaded
          ? "更新已下载"
          : `发现新版本${latestVersion}`;
  const description = isError
    ? status.message || "暂时无法获取更新信息。"
    : isInstalling
      ? "应用会自动重启并完成安装。"
      : isDownloading
        ? `下载进度 ${status.progress}%`
        : isDownloaded
          ? "应用即将重启并安装更新。"
          : `当前版本 ${status.currentVersion || "未知"}，点击后会下载并自动安装。`;

  return (
    <section className={`update-banner ${isError ? "is-error" : ""}`} role="status" aria-live="polite">
      <div className="update-banner-icon">
        {isError ? <RefreshCw size={18} /> : <Download size={18} />}
      </div>
      <div className="update-banner-content">
        <strong>{title}</strong>
        <p>{description}</p>
        {isDownloading || isInstalling ? (
          <div className="update-progress" aria-label={`更新下载进度 ${status.progress}%`}>
            <span style={{ width: `${status.progress}%` }} />
          </div>
        ) : null}
      </div>
      <div className="update-banner-actions">
        {isError ? (
          <button className="secondary-button" type="button" onClick={onRetry} disabled={isBusy}>
            <RefreshCw size={16} />
            重试
          </button>
        ) : status.state === "available" ? (
          <button className="primary-button" type="button" onClick={onDownload} disabled={isBusy}>
            <Download size={16} />
            {isBusy ? "准备中" : "下载并安装"}
          </button>
        ) : null}
        {canDismiss ? (
          <button className="icon-button" type="button" onClick={onDismiss} title="关闭更新提示">
            <X size={16} />
          </button>
        ) : null}
      </div>
    </section>
  );
}

function formatSlotStartTime(slot) {
  return `${String(slot.startHour).padStart(2, "0")}:00`;
}

function getDailyProgressNextHint(progress) {
  if (progress.available > 0 || progress.isReached || !progress.nextSlot) {
    return "";
  }

  return `下次 ${progress.nextSlot.label} ${formatSlotStartTime(progress.nextSlot)}`;
}

function DailyProgressBadge({ progress }) {
  const nextHint = getDailyProgressNextHint(progress);

  return (
    <div className={`daily-progress ${progress.isReached ? "is-complete" : ""}`}>
      <span>今日进度</span>
      <strong>
        {progress.done}/{progress.target}
      </strong>
      {progress.missed > 0 ? <em>错过 {progress.missed}</em> : null}
      {nextHint ? <em className="daily-progress-next">{nextHint}</em> : null}
    </div>
  );
}

function Metric({ icon, label, value, tone = "default" }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function EmptyState({ icon, text }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function MobileHomePanel({
  captureStatus,
  isVoiceListening,
  now,
  onAddToCalendar,
  onCompleteTask,
  onOpenFullBoard,
  onQuickTextChange,
  onStartTask,
  onStartVoice,
  onSubmitQuickTask,
  onViewTask,
  quickText,
  tasks,
}) {
  const overdueCount = tasks.filter((task) => isOverdue(task, now)).length;

  return (
    <section className="mobile-home" aria-label="手机工作台">
      <div className="mobile-home-heading">
        <div>
          <p className="eyebrow">Mobile</p>
          <h2>今日待办</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenFullBoard}>
          <ListChecks size={17} />
          看板
        </button>
      </div>

      <div className="mobile-stat-strip" aria-label="今日概览">
        <span aria-label={`今日重点 ${tasks.length} 项`}>
          <ListChecks size={15} />
          {tasks.length}
        </span>
        <span aria-label={`逾期 ${overdueCount} 项`}>
          <Bell size={15} />
          {overdueCount}
        </span>
      </div>

      <form className="mobile-capture" onSubmit={onSubmitQuickTask}>
        <label>
          速记
          <textarea
            value={quickText}
            onChange={(event) => onQuickTextChange(event.target.value)}
            rows={2}
            placeholder="例如：下午问王总合同"
          />
        </label>
        <div className="mobile-capture-actions">
          <button className="secondary-button" type="button" onClick={onStartVoice}>
            <MessageSquareText size={17} />
            {isVoiceListening ? "停止" : "语音"}
          </button>
          <button className="primary-button" type="submit">
            <Plus size={17} />
            创建
          </button>
        </div>
        {captureStatus ? <p className="mobile-capture-status">{captureStatus}</p> : null}
      </form>

      <div className="mobile-task-list">
        {tasks.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={23} />} text="今天没有需要盯住的任务" />
        ) : (
          tasks.map((task) => (
            <MobileTaskCard
              key={task.id}
              task={task}
              now={now}
              onAddToCalendar={onAddToCalendar}
              onCompleteTask={onCompleteTask}
              onStartTask={onStartTask}
              onViewTask={onViewTask}
            />
          ))
        )}
      </div>
    </section>
  );
}

function MobileTaskCard({ task, now, onAddToCalendar, onCompleteTask, onStartTask, onViewTask }) {
  const priority = getPriorityMeta(task.priority);
  const status = getStatusMeta(task.status);
  const dailyProgress = getDailyProgress(task, now);
  const reminderAt = getTaskReminderAt(task);
  const reminderWindowLabel = formatReminderWindow(task);

  return (
    <article className={`mobile-task-card priority-${task.priority}`}>
      <button className="mobile-task-summary" type="button" onClick={() => onViewTask(task)}>
        <span>{task.title}</span>
        <strong>{status.label}</strong>
      </button>
      <div className="mobile-task-meta">
        <span>{priority.label}</span>
        {task.dueAt ? (
          <span>
            <CalendarClock size={14} />
            {formatDateTime(task.dueAt)}
          </span>
        ) : null}
        {reminderWindowLabel ? (
          <span>
            <Bell size={14} />
            {reminderWindowLabel}
          </span>
        ) : reminderAt ? (
          <span>
            <Bell size={14} />
            {formatDateTime(reminderAt)}
          </span>
        ) : null}
        {task.owner ? <span>{task.owner}</span> : null}
      </div>
      {dailyProgress.isScheduled ? (
        <DailyProgressBadge progress={dailyProgress} />
      ) : null}
      <div className="mobile-task-actions">
        <button type="button" onClick={() => onStartTask(task)}>
          开始
        </button>
        <button
          type="button"
          onClick={() => onCompleteTask(task)}
          disabled={dailyProgress.isScheduled && dailyProgress.available === 0}
        >
          {dailyProgress.isScheduled ? "完成一次" : "完成"}
        </button>
        {task.dueAt ? (
          <button type="button" onClick={() => onAddToCalendar(task)}>
            日历
          </button>
        ) : null}
        <button type="button" onClick={() => onViewTask(task)}>
          详情
        </button>
      </div>
    </article>
  );
}

function ReportPanel({
  dailyReport,
  visibleLogs,
  logRange,
  onCancelDuplicateTasks,
  onLogRangeChange,
  onMarkStaleTask,
  onMergeSimilarTasks,
  onPreviewAttachment,
  onViewTask,
  organizingSuggestions,
}) {
  return (
    <div className="report-panel">
      <div className="section-toolbar report-toolbar">
        <div>
          <p className="eyebrow">Daily Report</p>
          <h2>工作日报</h2>
        </div>
        <FileText size={20} />
      </div>

      <div className="segmented-control compact report-range" aria-label="日志范围">
        {logRanges.map((range) => (
          <button
            key={range.value}
            className={logRange === range.value ? "is-active" : ""}
            type="button"
            onClick={() => onLogRangeChange(range.value)}
          >
            {range.label}
          </button>
        ))}
      </div>

      <div className="daily-report">
        <div className="report-card">
          <strong>日报概览</strong>
          <div className="report-metrics">
            <span>创建 {dailyReport.metrics.created}</span>
            <span>执行 {dailyReport.metrics.started}</span>
            <span>完成 {dailyReport.metrics.completed}</span>
            <span>未完成 {dailyReport.metrics.active}</span>
            <span>等待他人 {dailyReport.metrics.waiting}</span>
            <span>逾期 {dailyReport.metrics.overdue}</span>
            <span>错过时段 {dailyReport.metrics.missed}</span>
          </div>
        </div>

        <div className="report-grid">
          <article className="report-section">
            <strong>今日完成</strong>
            <ReportTaskList
              emptyText="今天还没有完成任务。"
              onPreviewAttachment={onPreviewAttachment}
              onViewTask={onViewTask}
              tasks={dailyReport.sections.completedTasks}
            />
          </article>

          <article className="report-section">
            <strong>未完成 / 逾期</strong>
            <ReportTaskList
              emptyText="今天没有逾期任务。"
              onPreviewAttachment={onPreviewAttachment}
              onViewTask={onViewTask}
              tasks={dailyReport.sections.overdueTasks}
            />
          </article>

          <article className="report-section">
            <strong>等待他人</strong>
            <ReportTaskList
              emptyText="今天没有等待他人的事项。"
              onPreviewAttachment={onPreviewAttachment}
              onViewTask={onViewTask}
              tasks={dailyReport.sections.waitingTasks}
            />
          </article>

          <article className="report-section">
            <strong>明日重点</strong>
            <ReportTaskList
              emptyText="暂无重点任务。"
              onPreviewAttachment={onPreviewAttachment}
              onViewTask={onViewTask}
              tasks={dailyReport.sections.tomorrowFocus}
            />
          </article>
        </div>
      </div>

      <OrganizingPanel
        onCancelDuplicateTasks={onCancelDuplicateTasks}
        onMarkStaleTask={onMarkStaleTask}
        onMergeSimilarTasks={onMergeSimilarTasks}
        onViewTask={onViewTask}
        suggestions={organizingSuggestions}
      />

      <h3 className="log-title">日志明细</h3>
      <div className="log-list">
        {visibleLogs.length === 0 ? (
          <EmptyState icon={<FileText size={22} />} text="还没有日志记录" />
        ) : (
          visibleLogs.map((log) => (
            <article className="log-item" key={log.id}>
              <strong>{log.action}</strong>
              <span>{formatDateTime(log.createdAt)}</span>
              <p>{log.taskTitle || log.detail}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

function OrganizingPanel({
  onCancelDuplicateTasks,
  onMarkStaleTask,
  onMergeSimilarTasks,
  onViewTask,
  suggestions,
}) {
  const duplicateGroups = suggestions?.duplicateGroups || [];
  const similarGroups = suggestions?.similarGroups || [];
  const staleTasks = suggestions?.staleTasks || [];
  const suggestionCount = duplicateGroups.length + similarGroups.length + staleTasks.length;

  return (
    <section className="organizing-panel" aria-label="AI任务整理">
      <div className="organizing-heading">
        <div>
          <p className="eyebrow">AI Organize</p>
          <h3>AI任务整理</h3>
        </div>
        <span>{suggestionCount > 0 ? `${suggestionCount} 条建议` : "今日清爽"}</span>
      </div>

      {suggestionCount === 0 ? (
        <EmptyState icon={<Wand2 size={22} />} text="没有发现重复、相似或长期未完成任务" />
      ) : (
        <div className="organizing-list">
          {duplicateGroups.map((group) => (
            <OrganizingGroupCard
              actionLabel="取消重复项"
              key={group.id}
              kind="重复任务"
              onApply={() => onCancelDuplicateTasks(group)}
              onViewTask={onViewTask}
              reason={group.reason}
              tasks={group.tasks}
            />
          ))}

          {similarGroups.map((group) => (
            <OrganizingGroupCard
              actionLabel="合并到主任务"
              key={group.id}
              kind="相似任务"
              onApply={() => onMergeSimilarTasks(group)}
              onViewTask={onViewTask}
              reason={group.reason}
              tasks={group.tasks}
            />
          ))}

          {staleTasks.map((item) => (
            <OrganizingStaleCard
              item={item}
              key={item.task.id}
              onApply={() => onMarkStaleTask(item.task)}
              onViewTask={onViewTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function OrganizingTaskButton({ onViewTask, task }) {
  const status = getStatusMeta(task.status);
  const priority = getPriorityMeta(task.priority);

  return (
    <button className="organizing-task" type="button" onClick={() => onViewTask(task)} title={`查看详情：${task.title}`}>
      <span>{task.title}</span>
      <em>
        {status.label} · {priority.label}
      </em>
    </button>
  );
}

function OrganizingGroupCard({ actionLabel, kind, onApply, onViewTask, reason, tasks }) {
  return (
    <article className="organizing-card">
      <div className="organizing-card-heading">
        <strong>{kind}</strong>
        <span>{tasks.length} 条</span>
      </div>
      <p>{reason}</p>
      <div className="organizing-task-list">
        {tasks.map((task) => (
          <OrganizingTaskButton key={task.id} onViewTask={onViewTask} task={task} />
        ))}
      </div>
      <button className="secondary-button" type="button" onClick={onApply}>
        <Wand2 size={16} />
        {actionLabel}
      </button>
    </article>
  );
}

function OrganizingStaleCard({ item, onApply, onViewTask }) {
  return (
    <article className="organizing-card stale">
      <div className="organizing-card-heading">
        <strong>长期未完成</strong>
        <span>{item.days} 天</span>
      </div>
      <p>{item.reason}</p>
      <OrganizingTaskButton onViewTask={onViewTask} task={item.task} />
      <button className="secondary-button" type="button" onClick={onApply}>
        <Wand2 size={16} />
        标记长期未完成
      </button>
    </article>
  );
}

function ReportTaskList({ emptyText, onPreviewAttachment, onViewTask, tasks }) {
  if (tasks.length === 0) {
    return <p>{emptyText}</p>;
  }

  return (
    <div className="report-task-list">
      {tasks.map((task) => (
        <ReportTaskItem
          key={task.id}
          task={task}
          onPreviewAttachment={onPreviewAttachment}
          onViewTask={onViewTask}
        />
      ))}
    </div>
  );
}

function ReportTaskItem({ task, onPreviewAttachment, onViewTask }) {
  const attachments = normalizeAttachments(task.attachments);
  const priority = getPriorityMeta(task.priority);
  const status = getStatusMeta(task.status);
  const reminderWindowLabel = formatReminderWindow(task);

  return (
    <article className="report-task-item">
      <button
        className="report-task-summary"
        type="button"
        onClick={() => onViewTask(task)}
        title={`查看详情：${task.title}`}
      >
        <span className="report-task-title">{task.title}</span>
        <span className="report-task-action">
          <Eye size={14} />
          详情
        </span>
        <span className="report-task-meta">
          <em>{status.label}</em>
          <em>{priority.label}</em>
          {task.dueAt ? <em>{formatDateTime(task.dueAt)}</em> : null}
          {reminderWindowLabel ? <em>{reminderWindowLabel}</em> : null}
          {attachments.length > 0 ? <em>附件 {attachments.length}</em> : null}
        </span>
      </button>

      {attachments.length > 0 ? (
        <div className="report-task-attachments" aria-label={`${task.title} 的附件`}>
          {attachments.map((attachment) => (
            <button
              type="button"
              key={attachment.id}
              onClick={() => onPreviewAttachment(attachment)}
              title={`预览附件：${attachment.name}`}
            >
              {attachment.type === "image" && attachment.path.startsWith("data:image/") ? (
                <img className="task-attachment-thumb" src={attachment.path} alt="" />
              ) : (
                <Paperclip size={14} />
              )}
              <span>{attachment.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TaskDetailDialog({ task, now, onAddToCalendar, onClose, onCopy, onEdit, onPreviewAttachment }) {
  const attachments = normalizeAttachments(task.attachments);
  const priority = getPriorityMeta(task.priority);
  const status = getStatusMeta(task.status);
  const dailyProgress = getDailyProgress(task, now);
  const tags = Array.isArray(task.tags) ? task.tags : [];
  const reminderAt = getTaskReminderAt(task);
  const reminderWindowLabel = formatReminderWindow(task);
  const launchActionValue = normalizeLaunchAction(task.launchAction);
  const launchActionMeta = launchActionTypes.find((item) => item.value === launchActionValue.type);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="task-detail-dialog"
        role="dialog"
        aria-label={`任务详情：${task.title}`}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="task-detail-heading">
          <div>
            <p className="eyebrow">Task Detail</p>
            <h2>{task.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭详情">
            <X size={18} />
          </button>
        </div>

        <div className="task-detail-meta">
          <span>{status.label}</span>
          <span>{priority.label}</span>
          {task.dueAt ? (
            <span>
              <CalendarClock size={14} />
              {formatDateTime(task.dueAt)}
            </span>
          ) : (
            <span>未设置截止时间</span>
          )}
          {reminderWindowLabel ? (
            <span>
              <Bell size={14} />
              预定提醒 · {reminderWindowLabel}
            </span>
          ) : reminderAt ? (
            <span>
              <Bell size={14} />
              提前{getReminderIntervalMinutes(task)}分钟提醒 · 从 {formatDateTime(reminderAt)} 开始
            </span>
          ) : null}
          {task.owner ? <span>负责人：{task.owner}</span> : null}
          {task.source ? <span>来源：{task.source}</span> : null}
          {launchActionValue.target ? (
            <span title={launchActionValue.target}>
              {launchActionMeta?.label || "执行动作"}：{launchActionValue.target}
            </span>
          ) : null}
        </div>

        {dailyProgress.isScheduled ? (
          <>
            <DailyProgressBadge progress={dailyProgress} />
            <div className="slot-state-list">
              {dailyProgress.slotStates.map((slot) => (
                <span
                  className={[
                    "slot-state",
                    slot.isDone ? "is-done" : "",
                    slot.isMissed ? "is-missed" : "",
                    slot.isAvailable ? "is-available" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={slot.value}
                >
                  {slot.label}
                </span>
              ))}
            </div>
          </>
        ) : null}

        <div className="task-detail-grid">
          <section className="task-detail-card">
            <strong>任务说明</strong>
            {task.note ? <p>{task.note}</p> : <p className="task-detail-empty">暂无备注。</p>}
            {tags.length > 0 ? (
              <div className="tag-list task-detail-tags">
                {tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="task-detail-card">
            <strong>附件</strong>
            {attachments.length === 0 ? (
              <p className="task-detail-empty">暂无附件。</p>
            ) : (
              <div className="task-detail-attachment-list">
                {attachments.map((attachment) => (
                  <button
                    className="task-detail-attachment"
                    type="button"
                    key={attachment.id}
                    onClick={() => onPreviewAttachment(attachment)}
                    title={`预览附件：${attachment.name}`}
                  >
                    {attachment.type === "image" && attachment.path.startsWith("data:image/") ? (
                      <img className="task-detail-thumb" src={attachment.path} alt="" />
                    ) : (
                      <Paperclip size={18} />
                    )}
                    <span>
                      <strong>{attachment.name}</strong>
                      <em>{attachment.type === "image" ? "图片附件" : "文件附件"}</em>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="task-detail-actions">
          {task.dueAt ? (
            <button className="secondary-button" type="button" onClick={() => onAddToCalendar(task)}>
              <CalendarClock size={18} />
              添加到日历
            </button>
          ) : null}
          <button className="secondary-button" type="button" onClick={() => onCopy(task)}>
            <Copy size={18} />
            复制任务
          </button>
          <button className="secondary-button" type="button" onClick={() => onEdit(task)}>
            <FileText size={18} />
            编辑任务
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

function AttachmentPreviewDialog({ preview, onClose, onOpen }) {
  const { attachment, imageUrl, message, status } = preview;
  const hasImagePreview = status === "ready" && imageUrl;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="attachment-preview-dialog"
        role="dialog"
        aria-label={`附件预览：${attachment.name}`}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="attachment-preview-heading">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>{attachment.name}</h2>
            <span>{attachment.type === "image" ? "图片附件" : "文件附件"}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭预览">
            <X size={18} />
          </button>
        </div>

        <div className="attachment-preview-stage">
          {status === "loading" ? (
            <EmptyState icon={<ImageIcon size={26} />} text="正在加载预览" />
          ) : hasImagePreview ? (
            <img className="attachment-preview-image" src={imageUrl} alt={attachment.name} />
          ) : (
            <div className="attachment-preview-empty">
              <ImageIcon size={28} />
              <strong>暂无可用预览</strong>
              <p>{message || "这个附件暂时无法在应用内预览。"}</p>
            </div>
          )}
        </div>

        <div className="attachment-preview-actions">
          <button className="secondary-button" type="button" onClick={() => onOpen(attachment)}>
            <Paperclip size={18} />
            打开附件
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

function TaskRow({
  task,
  now,
  onCopy,
  onEdit,
  onStatusChange,
  onStart,
  onCompleteOnce,
  onPreviewAttachment,
  onDelete,
}) {
  const priority = getPriorityMeta(task.priority);
  const status = getStatusMeta(task.status);
  const statusTone = taskStatuses.some((item) => item.value === task.status) ? task.status : "todo";
  const overdue = isOverdue(task, now);
  const dailyProgress = getDailyProgress(task, now);
  const isScheduledTask = dailyProgress.isScheduled;
  const reminderAt = getTaskReminderAt(task);
  const reminderWindowLabel = formatReminderWindow(task);
  const taskAttachments = normalizeAttachments(task.attachments);
  const openEditor = () => onEdit(task);
  const stopRowClick = (event) => event.stopPropagation();
  const handleRowKeyDown = (event) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openEditor();
    }
  };

  return (
    <article
      className={`task-row priority-${task.priority} status-${statusTone} ${overdue ? "is-overdue" : ""}`}
      onClick={openEditor}
      onKeyDown={handleRowKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`编辑任务：${task.title}`}
    >
      <div className="task-main">
        <div className="task-title-line">
          <span className="priority-dot" aria-hidden="true" />
          <h3>{task.title}</h3>
        </div>
        <div className="task-meta">
          <span className={`task-status-pill status-${statusTone}`}>{status.label}</span>
          <span>{priority.label}</span>
          <span>
            <CalendarClock size={14} />
            {formatDateTime(task.dueAt)}
          </span>
          {reminderWindowLabel ? (
            <span>
              <Bell size={14} />
              预定提醒 · {reminderWindowLabel}
            </span>
          ) : reminderAt ? (
            <span>
              <Bell size={14} />
              提前{getReminderIntervalMinutes(task)}分钟提醒 · 从 {formatDateTime(reminderAt)} 开始
            </span>
          ) : null}
          {task.owner ? <span>{task.owner}</span> : null}
        </div>
        {isScheduledTask ? (
          <>
            <DailyProgressBadge progress={dailyProgress} />
            <div className="slot-state-list">
              {dailyProgress.slotStates.map((slot) => (
                <span
                  className={[
                    "slot-state",
                    slot.isDone ? "is-done" : "",
                    slot.isMissed ? "is-missed" : "",
                    slot.isAvailable ? "is-available" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={slot.value}
                >
                  {slot.label}
                </span>
              ))}
            </div>
          </>
        ) : null}
        {task.note ? <p className="task-note">{task.note}</p> : null}
        {taskAttachments.length > 0 ? (
          <div className="task-attachments" onClick={stopRowClick}>
            {taskAttachments.map((attachment) => (
              <button
                type="button"
                key={attachment.id}
                onClick={() => onPreviewAttachment(attachment)}
                title="预览附件"
              >
                {attachment.type === "image" && attachment.path.startsWith("data:image/") ? (
                  <img className="task-attachment-thumb" src={attachment.path} alt="" />
                ) : (
                  <Eye size={14} />
                )}
                <span>{attachment.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {task.tags.length > 0 ? (
          <div className="tag-list">
            {task.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="task-actions" onClick={stopRowClick}>
        <select value={task.status} onChange={(event) => onStatusChange(task, event.target.value)}>
          {taskStatuses.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onStart(task)}>
          开始执行
        </button>
        {isScheduledTask ? (
          <button type="button" onClick={() => onCompleteOnce(task)} disabled={dailyProgress.available === 0}>
            完成一次
          </button>
        ) : (
          <button type="button" onClick={() => onStatusChange(task, "done")} disabled={task.status === "done"}>
            完成任务
          </button>
        )}
        <button className="icon-button" type="button" onClick={() => onCopy(task)} title="复制任务">
          <Copy size={17} />
        </button>
        <button className="icon-button danger" type="button" onClick={() => onDelete(task)} title="删除任务">
          <Trash2 size={17} />
        </button>
      </div>
    </article>
  );
}

export default App;
