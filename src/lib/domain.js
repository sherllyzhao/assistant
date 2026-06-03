export const taskStatuses = [
  { value: "todo", label: "待办" },
  { value: "doing", label: "进行中" },
  { value: "waiting", label: "等待他人" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];

export const priorities = [
  { value: "high", label: "高优先级", reminderMinutes: 15 },
  { value: "normal", label: "普通", reminderMinutes: 30 },
  { value: "low", label: "低优先级", reminderMinutes: 60 },
];

export const logRanges = [
  { value: "today", label: "今日日志" },
  { value: "week", label: "本周日志" },
  { value: "month", label: "本月日志" },
];

export const dailySlots = [
  { value: "morning", label: "早上", startHour: 6, endHour: 12 },
  { value: "noon", label: "中午", startHour: 12, endHour: 14 },
  { value: "afternoon", label: "下午", startHour: 14, endHour: 18 },
  { value: "evening", label: "晚上", startHour: 18, endHour: 24 },
];

export const launchActionTypes = [
  { value: "none", label: "不设置" },
  { value: "url", label: "打开网址" },
  { value: "path", label: "打开文件/文件夹" },
  { value: "vscode", label: "VSCode项目" },
  { value: "command", label: "打开软件命令" },
];

export const emptyLaunchAction = {
  type: "none",
  target: "",
};

export const emptyTaskDraft = {
  title: "",
  source: "手动录入",
  owner: "",
  dueAt: "",
  dailyTarget: 0,
  dailySlotValues: [],
  priority: "normal",
  status: "todo",
  tags: "",
  note: "",
  launchAction: emptyLaunchAction,
  attachments: [],
};

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function normalizeTags(value) {
  return String(value || "")
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function normalizeDailyTarget(value) {
  const numberValue = Number.parseInt(value, 10);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.min(Math.max(numberValue, 0), 24);
}

export function normalizeDailySlots(value, fallbackTarget = 0) {
  const values = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  const validValues = dailySlots.map((slot) => slot.value);
  const uniqueValues = [...new Set(values)].filter((item) => validValues.includes(item));

  if (uniqueValues.length > 0) {
    return uniqueValues;
  }

  const normalizedTarget = normalizeDailyTarget(fallbackTarget);

  if (normalizedTarget === 0) {
    return [];
  }

  const fallbackSlotsByTarget = {
    1: ["morning"],
    2: ["morning", "evening"],
    3: ["morning", "afternoon", "evening"],
  };
  const fallbackSlots = fallbackSlotsByTarget[normalizedTarget];

  return fallbackSlots || dailySlots.map((slot) => slot.value);
}

export function getSlotMeta(value) {
  return dailySlots.find((slot) => slot.value === value) || dailySlots[0];
}

export function normalizeLaunchAction(action) {
  const validTypes = launchActionTypes.map((item) => item.value);
  const type = validTypes.includes(action?.type) ? action.type : "none";
  const target = String(action?.target || "").trim();

  if (type === "none" || !target) {
    return { ...emptyLaunchAction };
  }

  return { type, target };
}

export function createAttachment(filePath, now = new Date()) {
  const pathValue = String(filePath || "").trim();

  if (!pathValue) {
    throw new Error("附件路径不能为空");
  }

  const name = pathValue.split(/[\\/]/).filter(Boolean).pop() || pathValue;
  const isImage = /\.(apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);

  return {
    id: createId("attachment"),
    name,
    path: pathValue,
    type: isImage ? "image" : "file",
    addedAt: now.toISOString(),
  };
}

export function normalizeAttachments(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attachment) => {
      const pathValue = String(attachment?.path || "").trim();

      if (!pathValue) {
        return null;
      }

      const name = String(attachment?.name || pathValue.split(/[\\/]/).filter(Boolean).pop() || pathValue).trim();
      const type = attachment?.type === "image" ? "image" : "file";

      return {
        id: attachment?.id || createId("attachment"),
        name,
        path: pathValue,
        type,
        addedAt: attachment?.addedAt || new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

export function createTask(draft, now = new Date()) {
  const title = String(draft.title || "").trim();

  if (!title) {
    throw new Error("任务标题不能为空");
  }

  const dailySlotValues = normalizeDailySlots(draft.dailySlotValues ?? draft.dailySlots, draft.dailyTarget);

  return {
    id: createId("task"),
    title,
    source: String(draft.source || "手动录入").trim(),
    owner: String(draft.owner || "").trim(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : "",
    dailySlots: dailySlotValues,
    dailyTarget: dailySlotValues.length,
    completionRecords: [],
    priority: draft.priority || "normal",
    status: draft.status || "todo",
    tags: normalizeTags(draft.tags),
    note: String(draft.note || "").trim(),
    launchAction: normalizeLaunchAction(draft.launchAction),
    attachments: normalizeAttachments(draft.attachments),
    lastRemindedAt: "",
  };
}

export function createCandidate(text, source = "微信粘贴", now = new Date()) {
  return {
    id: createId("candidate"),
    text: text.trim(),
    source,
    detectedAt: now.toISOString(),
    remindedAt: "",
  };
}

export function createLog(action, task, detail = "", now = new Date()) {
  return {
    id: createId("log"),
    action,
    taskId: task?.id || "",
    taskTitle: task?.title || "",
    detail,
    createdAt: now.toISOString(),
  };
}

export function getPriorityMeta(priority) {
  return priorities.find((item) => item.value === priority) || priorities[1];
}

export function getStatusMeta(status) {
  return taskStatuses.find((item) => item.value === status) || taskStatuses[0];
}

export function isActiveTask(task) {
  return !["done", "cancelled"].includes(task.status);
}

export function isOverdue(task, now = new Date()) {
  return Boolean(task.dueAt && isActiveTask(task) && new Date(task.dueAt).getTime() < now.getTime());
}

export function getReminderLeadMinutes(task) {
  return getPriorityMeta(task?.priority).reminderMinutes;
}

export function getTaskReminderAt(task) {
  if (!task?.dueAt) {
    return "";
  }

  const dueTime = new Date(task.dueAt).getTime();

  if (!Number.isFinite(dueTime)) {
    return "";
  }

  return new Date(dueTime - getReminderLeadMinutes(task) * 60 * 1000).toISOString();
}

export function getLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

export function getTaskCompletionsForDate(task, date = new Date()) {
  const dateKey = getLocalDateKey(date);
  const records = Array.isArray(task?.completionRecords) ? task.completionRecords : [];

  return records.filter((record) => getLocalDateKey(record.completedAt || record) === dateKey);
}

export function getTaskDailySlots(task) {
  return normalizeDailySlots(task?.dailySlots, task?.dailyTarget);
}

export function getCurrentSlotValue(now = new Date()) {
  const hour = now.getHours();
  const slot = dailySlots.find((item) => hour >= item.startHour && hour < item.endHour);

  return slot?.value || "evening";
}

export function getDailyProgress(task, date = new Date()) {
  const slots = getTaskDailySlots(task);
  const records = getTaskCompletionsForDate(task, date);
  const currentHour = date.getHours();
  const currentSlotValue = getCurrentSlotValue(date);
  const completedSlotValues = new Set(
    records.map((record) => record.slot || getCurrentSlotValue(new Date(record.completedAt || record))),
  );
  const slotStates = slots.map((slotValue) => {
    const slot = getSlotMeta(slotValue);
    const isDone = completedSlotValues.has(slotValue);
    const isMissed = !isDone && currentHour >= slot.endHour;
    const isAvailable = !isDone && !isMissed && slotValue === currentSlotValue;

    return {
      ...slot,
      isDone,
      isMissed,
      isAvailable,
    };
  });
  const done = slotStates.filter((slot) => slot.isDone).length;
  const missed = slotStates.filter((slot) => slot.isMissed).length;
  const available = slotStates.filter((slot) => slot.isAvailable).length;
  const target = slots.length;

  return {
    target,
    done,
    missed,
    available,
    remaining: Math.max(target - done - missed, 0),
    isScheduled: target > 0,
    isReached: target > 0 && done >= target,
    slotStates,
    currentSlotValue,
  };
}

export function shouldRemindTask(task, now = new Date()) {
  if (!task.dueAt || !isActiveTask(task)) {
    return false;
  }

  const dueTime = new Date(task.dueAt).getTime();
  const reminderWindow = getReminderLeadMinutes(task) * 60 * 1000;
  const lastRemindedTime = task.lastRemindedAt ? new Date(task.lastRemindedAt).getTime() : 0;
  const nowTime = now.getTime();

  if (!Number.isFinite(dueTime)) {
    return false;
  }

  return nowTime >= dueTime - reminderWindow && nowTime - lastRemindedTime > reminderWindow;
}

export function shouldRemindCandidate(candidate, now = new Date()) {
  const detectedAt = new Date(candidate.detectedAt).getTime();
  const remindedAt = candidate.remindedAt ? new Date(candidate.remindedAt).getTime() : 0;
  const thirtyMinutes = 30 * 60 * 1000;

  return now.getTime() - detectedAt >= thirtyMinutes && remindedAt === 0;
}

export function detectCandidatesFromText(text) {
  const keywords = /(安排|提醒|记得|处理|确认|跟进|发送|发|提交|截止|今天|明天|周|月底|报价|合同|开会)/;
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .filter((line) => keywords.test(line))
    .slice(0, 20)
    .map((line) => createCandidate(line));

  if (candidates.length > 0) {
    return candidates;
  }

  const compactText = String(text || "").trim();
  return compactText ? [createCandidate(compactText)] : [];
}

export function candidateToDraft(candidate) {
  return {
    ...emptyTaskDraft,
    title: candidate.text.replace(/^[^：:]{1,12}[：:]\s*/, "").slice(0, 60),
    source: candidate.source,
    note: candidate.text,
  };
}

export function formatDateTime(value) {
  if (!value) {
    return "未设置";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toDateTimeInputValue(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function filterLogsByRange(logs, range, now = new Date()) {
  const start = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  }

  if (range === "week") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
  }

  if (range === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return logs.filter((log) => new Date(log.createdAt).getTime() >= start.getTime());
}

export function createDailyReport(tasks, logs, range = "today", now = new Date()) {
  const scopedLogs = filterLogsByRange(logs, range, now);
  const activeTasks = tasks.filter((task) => isActiveTask(task));
  const completedTasks = tasks.filter((task) => task.status === "done");
  const waitingTasks = tasks.filter((task) => task.status === "waiting");
  const overdueTasks = activeTasks.filter((task) => isOverdue(task, now));
  const missedTasks = activeTasks
    .map((task) => ({
      task,
      progress: getDailyProgress(task, now),
    }))
    .filter((item) => item.progress.missed > 0);
  const startedLogs = scopedLogs.filter((log) => log.action === "开始执行任务");
  const completedLogs = scopedLogs.filter((log) => log.action === "完成任务");
  const createdLogs = scopedLogs.filter((log) => log.action === "创建任务");
  const tomorrowFocus = activeTasks
    .slice()
    .sort((a, b) => {
      const priorityScore = { high: 0, normal: 1, low: 2 };
      const dueA = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return priorityScore[a.priority] - priorityScore[b.priority] || dueA - dueB;
    })
    .slice(0, 5);

  return {
    range,
    generatedAt: now.toISOString(),
    metrics: {
      logs: scopedLogs.length,
      created: createdLogs.length,
      started: startedLogs.length,
      completed: completedLogs.length,
      active: activeTasks.length,
      waiting: waitingTasks.length,
      overdue: overdueTasks.length,
      missed: missedTasks.reduce((sum, item) => sum + item.progress.missed, 0),
    },
    sections: {
      completedTasks,
      activeTasks,
      waitingTasks,
      overdueTasks,
      missedTasks,
      tomorrowFocus,
      recentLogs: scopedLogs.slice().reverse().slice(0, 8),
    },
  };
}
