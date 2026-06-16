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

const maxDailySlotReminderRecords = 120;
const staleTaskThresholdDays = 14;
const mergeableSimilarityThreshold = 0.72;

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

const weekdayMap = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};
const defaultSmartDueTime = { hour: 18, minute: 0 };

function isValidDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function getFiniteTime(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : NaN;
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function setLocalTime(value, hour = defaultSmartDueTime.hour, minute = defaultSmartDueTime.minute) {
  const date = new Date(value);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function getLocalWeekStart(value) {
  const start = startOfLocalDay(value);
  const day = start.getDay() || 7;
  start.setDate(start.getDate() - day + 1);
  return start;
}

function normalizeClockHour(hour, meridiem) {
  if (/下午|晚上|今晚/.test(meridiem) && hour < 12) {
    return hour + 12;
  }

  if (/中午/.test(meridiem) && hour < 11) {
    return hour + 12;
  }

  if (/凌晨|早上|上午/.test(meridiem) && hour === 12) {
    return 0;
  }

  return hour;
}

function parseClockFromText(text) {
  const clockText = String(text || "");
  const colonMatch = clockText.match(/(凌晨|早上|上午|中午|下午|晚上|今晚)?\s*(\d{1,2})[:：](\d{2})/);

  if (colonMatch) {
    const hour = normalizeClockHour(Number.parseInt(colonMatch[2], 10), colonMatch[1] || "");
    const minute = Number.parseInt(colonMatch[3], 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const pointMatch = clockText.match(
    /(凌晨|早上|上午|中午|下午|晚上|今晚)?\s*(\d{1,2})点(?:(半)|(\d{1,2})分?)?/,
  );

  if (pointMatch) {
    const hour = normalizeClockHour(Number.parseInt(pointMatch[2], 10), pointMatch[1] || "");
    const minute = pointMatch[3] ? 30 : Number.parseInt(pointMatch[4] || "0", 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
}

function getTextTimeHint(text) {
  const clock = parseClockFromText(text);

  if (clock) {
    return clock;
  }

  if (/凌晨/.test(text)) {
    return { hour: 8, minute: 0 };
  }

  if (/早上|上午/.test(text)) {
    return { hour: 12, minute: 0 };
  }

  if (/中午/.test(text)) {
    return { hour: 14, minute: 0 };
  }

  if (/下午|下班前/.test(text)) {
    return { hour: 18, minute: 0 };
  }

  if (/晚上|今晚/.test(text)) {
    return { hour: 22, minute: 0 };
  }

  return defaultSmartDueTime;
}

function applyTextTime(value, text) {
  const time = getTextTimeHint(text);
  return setLocalTime(value, time.hour, time.minute);
}

function parseMonthDateDueAt(text, now) {
  const monthDateMatch = String(text || "").match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?/);

  if (!monthDateMatch) {
    return null;
  }

  const hasYear = Boolean(monthDateMatch[1]);
  const year = Number.parseInt(monthDateMatch[1] || String(now.getFullYear()), 10);
  const month = Number.parseInt(monthDateMatch[2], 10);
  const day = Number.parseInt(monthDateMatch[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  let dueAt = applyTextTime(new Date(year, month - 1, day), text);

  if (dueAt.getMonth() !== month - 1) {
    return null;
  }

  if (!hasYear && startOfLocalDay(dueAt).getTime() < startOfLocalDay(now).getTime()) {
    dueAt = applyTextTime(new Date(year + 1, month - 1, day), text);
  }

  return dueAt;
}

function parseNumericDateDueAt(text, now) {
  const numericMatch = String(text || "").match(/(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})/);

  if (!numericMatch) {
    return null;
  }

  const hasYear = Boolean(numericMatch[1]);
  const year = Number.parseInt(numericMatch[1] || String(now.getFullYear()), 10);
  const month = Number.parseInt(numericMatch[2], 10);
  const day = Number.parseInt(numericMatch[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  let dueAt = applyTextTime(new Date(year, month - 1, day), text);

  if (dueAt.getMonth() !== month - 1) {
    return null;
  }

  if (!hasYear && startOfLocalDay(dueAt).getTime() < startOfLocalDay(now).getTime()) {
    dueAt = applyTextTime(new Date(year + 1, month - 1, day), text);
  }

  return dueAt;
}

function parseWeekdayDueAt(text, now) {
  const weekMatch = String(text || "").match(
    /(下周|下星期|下礼拜|本周|这周|本星期|这星期|本礼拜|这礼拜)?(?:周|星期|礼拜)([一二三四五六日天])/,
  );

  if (!weekMatch) {
    return null;
  }

  const prefix = weekMatch[1] || "";
  const targetDay = weekdayMap[weekMatch[2]];
  const weekOffset = /^下/.test(prefix) ? 1 : 0;
  const weekStart = getLocalWeekStart(now);
  const normalizedTargetDay = targetDay === 0 ? 7 : targetDay;
  let dueAt = applyTextTime(addLocalDays(weekStart, normalizedTargetDay - 1 + weekOffset * 7), text);

  if (!prefix && dueAt.getTime() < now.getTime()) {
    dueAt = addLocalDays(dueAt, 7);
  }

  return dueAt;
}

function parseWeekRangeDueAt(text, now) {
  if (/周末/.test(text)) {
    const weekStart = getLocalWeekStart(now);
    return applyTextTime(addLocalDays(weekStart, 6), text);
  }

  if (/下周|下星期|下礼拜/.test(text)) {
    const weekStart = getLocalWeekStart(now);
    return applyTextTime(addLocalDays(weekStart, 13), text);
  }

  if (/本周|这周|周内|本星期|这星期|本礼拜|这礼拜/.test(text)) {
    const weekStart = getLocalWeekStart(now);
    return applyTextTime(addLocalDays(weekStart, 6), text);
  }

  return null;
}

function parseMonthEndDueAt(text, now) {
  const monthEndMatch = String(text || "").match(/(下个月|下月|下|本月|这个月)?(?:月底|月末)/);

  if (!monthEndMatch) {
    return null;
  }

  const monthOffset = /^下/.test(monthEndMatch[1] || "") ? 1 : 0;
  const dueAt = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  return applyTextTime(dueAt, text);
}

function parseRelativeDueAt(text, now) {
  if (/后天/.test(text)) {
    return applyTextTime(addLocalDays(now, 2), text);
  }

  if (/明天|明日/.test(text)) {
    return applyTextTime(addLocalDays(now, 1), text);
  }

  if (/今天|今日|今晚/.test(text)) {
    return applyTextTime(now, text);
  }

  return null;
}

function parseTimeOnlyDueAt(text, now) {
  if (!parseClockFromText(text) && !/凌晨|早上|上午|中午|下午|下班前|晚上|今晚/.test(text)) {
    return null;
  }

  let dueAt = applyTextTime(now, text);

  if (!/今天|今日|今晚/.test(text) && dueAt.getTime() <= now.getTime()) {
    dueAt = addLocalDays(dueAt, 1);
  }

  return dueAt;
}

function inferDueAtFromText(text, now) {
  const cleanText = String(text || "").trim();

  if (!cleanText) {
    return null;
  }

  return (
    parseNumericDateDueAt(cleanText, now) ||
    parseMonthDateDueAt(cleanText, now) ||
    parseWeekdayDueAt(cleanText, now) ||
    parseRelativeDueAt(cleanText, now) ||
    parseWeekRangeDueAt(cleanText, now) ||
    parseMonthEndDueAt(cleanText, now) ||
    parseTimeOnlyDueAt(cleanText, now)
  );
}

function cleanContactName(value) {
  return String(value || "")
    .replace(/^[\s@]+/, "")
    .replace(/[，,。；;！!？?\s].*$/, "")
    .replace(/^(客户|联系人|同事|负责人)[:：]?/, "")
    .trim()
    .slice(0, 12);
}

function inferContactFromText(text) {
  const cleanText = String(text || "").trim();
  const speakerMatch = cleanText.match(/^([^：:\n]{2,12})[：:]/);

  if (speakerMatch) {
    return cleanContactName(speakerMatch[1]);
  }

  const titledContactMatch = cleanText.match(
    /(?:给|问|找|联系|跟进|催|发给|发送给)([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-zA-Z0-9]{0,6}(?:总|经理|主管|老师|主任|老板|姐|哥))/,
  );

  if (titledContactMatch) {
    return cleanContactName(titledContactMatch[1]);
  }

  const looseContactMatch = cleanText.match(
    /([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-zA-Z0-9]{0,6}(?:总|经理|主管|老师|主任|老板))/,
  );

  if (looseContactMatch) {
    return cleanContactName(looseContactMatch[1]);
  }

  return "";
}

function mergeTagText(value, nextTags) {
  const tags = normalizeTags(value);

  for (const tag of nextTags) {
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags.join(" ");
}

function isSameLocalDate(left, right) {
  return startOfLocalDay(left).getTime() === startOfLocalDay(right).getTime();
}

function inferPriorityFromTextAndDueAt(text, dueAt, now) {
  const cleanText = String(text || "");

  if (/紧急|尽快|马上|立刻|今天|今日|今晚/.test(cleanText)) {
    return "high";
  }

  if (isValidDate(dueAt) && isSameLocalDate(dueAt, now)) {
    return "high";
  }

  if (/月底|月末|长期|不急|有空/.test(cleanText)) {
    return "low";
  }

  if (/本周|这周|周内|周[一二三四五六日天]|星期[一二三四五六日天]|礼拜[一二三四五六日天]/.test(cleanText)) {
    return "normal";
  }

  if (isValidDate(dueAt) && dueAt.getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000) {
    return "normal";
  }

  return "normal";
}

function getDraftIntelligenceText(draft) {
  return [draft?.title, draft?.note]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function inferTaskIntelligence(text, now = new Date()) {
  const cleanText = String(text || "").trim();
  const dueAt = inferDueAtFromText(cleanText, now);
  const owner = inferContactFromText(cleanText);

  return {
    dueAt: isValidDate(dueAt) ? dueAt.toISOString() : "",
    owner,
    priority: inferPriorityFromTextAndDueAt(cleanText, dueAt, now),
    tags: owner ? ["客户"] : [],
  };
}

export function applyTaskIntelligence(draft, now = new Date()) {
  const text = getDraftIntelligenceText(draft);
  const intelligence = inferTaskIntelligence(text, now);
  const dueAt = draft?.dueAt || intelligence.dueAt;
  const dueAtDate = dueAt ? new Date(dueAt) : null;
  const priority =
    draft?.priority && draft.priority !== "normal"
      ? draft.priority
      : inferPriorityFromTextAndDueAt(text, dueAtDate, now);

  return {
    ...draft,
    dueAt,
    owner: String(draft?.owner || "").trim() || intelligence.owner,
    priority,
    tags: intelligence.tags.length > 0 ? mergeTagText(draft?.tags, intelligence.tags) : draft?.tags,
  };
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
  const smartDraft = applyTaskIntelligence(draft, now);
  const title = String(smartDraft.title || "").trim();
  const createdAt = now.toISOString();

  if (!title) {
    throw new Error("任务标题不能为空");
  }

  const dailySlotValues = normalizeDailySlots(
    smartDraft.dailySlotValues ?? smartDraft.dailySlots,
    smartDraft.dailyTarget,
  );

  return {
    id: createId("task"),
    title,
    source: String(smartDraft.source || "手动录入").trim(),
    owner: String(smartDraft.owner || "").trim(),
    createdAt,
    updatedAt: createdAt,
    dueAt: smartDraft.dueAt ? new Date(smartDraft.dueAt).toISOString() : "",
    dailySlots: dailySlotValues,
    dailyTarget: dailySlotValues.length,
    completionRecords: [],
    dailySlotReminderRecords: [],
    priority: smartDraft.priority || "normal",
    status: smartDraft.status || "todo",
    completedAt: smartDraft.status === "done" ? createdAt : "",
    tags: normalizeTags(smartDraft.tags),
    note: String(smartDraft.note || "").trim(),
    launchAction: normalizeLaunchAction(smartDraft.launchAction),
    attachments: normalizeAttachments(smartDraft.attachments),
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

export function getReminderIntervalMinutes(task) {
  return getPriorityMeta(task?.priority).reminderMinutes;
}

export function getReminderLeadMinutes(task) {
  return getReminderIntervalMinutes(task);
}

export function getTaskReminderAt(task) {
  if (!task?.dueAt) {
    return "";
  }

  const dueTime = getFiniteTime(task.dueAt);

  if (!Number.isFinite(dueTime)) {
    return "";
  }

  const reminderOffsetMs = getReminderLeadMinutes(task) * 60 * 1000;

  if (!Number.isFinite(reminderOffsetMs) || reminderOffsetMs < 0) {
    return new Date(dueTime).toISOString();
  }

  return new Date(dueTime - reminderOffsetMs).toISOString();
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

function getDailySlotReminderRecordDateKey(record) {
  const time = getFiniteTime(record?.remindedAt || record);

  return Number.isFinite(time) ? getLocalDateKey(time) : "";
}

function getDailySlotReminderRecordSlot(record) {
  if (dailySlots.some((slot) => slot.value === record?.slot)) {
    return record.slot;
  }

  const time = getFiniteTime(record?.remindedAt || record);

  return Number.isFinite(time) ? getCurrentSlotValue(new Date(time)) : "";
}

export function normalizeDailySlotReminderRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => getDailySlotReminderRecordDateKey(record))
    .slice(-maxDailySlotReminderRecords);
}

export function getTaskDailySlotRemindersForDate(task, date = new Date()) {
  const dateKey = getLocalDateKey(date);
  const records = normalizeDailySlotReminderRecords(task?.dailySlotReminderRecords);

  return records.filter((record) => getDailySlotReminderRecordDateKey(record) === dateKey);
}

export function createDailySlotReminderRecord(task, slot, date = new Date()) {
  return {
    id: `${task?.id || "task"}_slot_reminder_${slot.value}_${date.getTime()}`,
    remindedAt: date.toISOString(),
    slot: slot.value,
  };
}

export function getDailySlotReminderKey(task, slot, date = new Date()) {
  return `${task?.id || "task"}:${slot.value}:${getLocalDateKey(date)}`;
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
  const nextSlot = slotStates.find((slot) => !slot.isDone && !slot.isMissed) || null;
  const target = slots.length;

  return {
    target,
    done,
    missed,
    available,
    remaining: Math.max(target - done - missed, 0),
    isScheduled: target > 0,
    isReached: target > 0 && done >= target,
    nextSlot,
    slotStates,
    currentSlotValue,
  };
}

export function getPendingDailySlotReminder(task, date = new Date()) {
  if (!isActiveTask(task)) {
    return null;
  }

  const progress = getDailyProgress(task, date);

  if (!progress.isScheduled) {
    return null;
  }

  const availableSlot = progress.slotStates.find((slot) => slot.isAvailable);

  if (!availableSlot) {
    return null;
  }

  const remindedSlots = new Set(
    getTaskDailySlotRemindersForDate(task, date).map((record) => getDailySlotReminderRecordSlot(record)),
  );

  return remindedSlots.has(availableSlot.value) ? null : availableSlot;
}

export function shouldRemindTask(task, now = new Date()) {
  if (!isActiveTask(task)) {
    return false;
  }

  const reminderInterval = getReminderIntervalMinutes(task) * 60 * 1000;
  const fallbackStartTime = getFiniteTime(task?.createdAt || task?.updatedAt);
  const reminderStartTime = task?.dueAt
    ? getFiniteTime(getTaskReminderAt(task))
    : fallbackStartTime + reminderInterval;
  const lastRemindedTime = task.lastRemindedAt ? getFiniteTime(task.lastRemindedAt) : 0;
  const nowTime = now.getTime();

  if (
    !Number.isFinite(reminderStartTime) ||
    !Number.isFinite(reminderInterval) ||
    reminderInterval <= 0
  ) {
    return false;
  }

  if (nowTime < reminderStartTime) {
    return false;
  }

  return !Number.isFinite(lastRemindedTime) || lastRemindedTime === 0 || nowTime - lastRemindedTime >= reminderInterval;
}

export function shouldRemindCandidate(candidate, now = new Date()) {
  const detectedAt = getFiniteTime(candidate?.detectedAt);
  const remindedAt = candidate?.remindedAt ? getFiniteTime(candidate.remindedAt) : 0;
  const thirtyMinutes = 30 * 60 * 1000;

  return (
    Number.isFinite(detectedAt) &&
    now.getTime() - detectedAt >= thirtyMinutes &&
    (!Number.isFinite(remindedAt) || remindedAt === 0)
  );
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
  const detectedAt = new Date(candidate.detectedAt || Date.now());
  const now = isValidDate(detectedAt) ? detectedAt : new Date();

  return applyTaskIntelligence({
    ...emptyTaskDraft,
    title: candidate.text.replace(/^[^：:]{1,12}[：:]\s*/, "").slice(0, 60),
    source: candidate.source,
    note: candidate.text,
  }, now);
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

function normalizeTaskTitleExactKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[【】"'“”‘’、，,。.!！?？:：;；()[\]（）<>《》\s]/g, "")
    .trim();
}

function normalizeTaskTitleForOrganizing(value) {
  return normalizeTaskTitleExactKey(value)
    .replace(/^(请|帮我|麻烦|记得|提醒我|需要|处理|跟进|确认|发送|发|提交|完成|做一下)/, "")
    .replace(/(一下|下|这个|这件事|事项|任务)$/g, "")
    .trim();
}

function tokenizeTaskTitle(value) {
  const normalized = normalizeTaskTitleForOrganizing(value);
  const tokens = new Set();

  for (const match of normalized.matchAll(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/gi)) {
    const token = match[0];

    if (token.length <= 8) {
      tokens.add(token);
      continue;
    }

    for (let index = 0; index <= token.length - 2; index += 1) {
      tokens.add(token.slice(index, index + 2));
    }
  }

  if (tokens.size === 0 && normalized) {
    tokens.add(normalized);
  }

  return tokens;
}

function getTitleSimilarity(left, right) {
  const leftExactKey = normalizeTaskTitleExactKey(left);
  const rightExactKey = normalizeTaskTitleExactKey(right);

  if (leftExactKey && leftExactKey === rightExactKey) {
    return 1;
  }

  const leftKey = normalizeTaskTitleForOrganizing(left);
  const rightKey = normalizeTaskTitleForOrganizing(right);

  if (!leftKey || !rightKey) {
    return 0;
  }

  if (leftKey === rightKey) {
    return 0.92;
  }

  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) {
    return Math.min(leftKey.length, rightKey.length) / Math.max(leftKey.length, rightKey.length);
  }

  const leftTokens = tokenizeTaskTitle(leftKey);
  const rightTokens = tokenizeTaskTitle(rightKey);
  const intersectionSize = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;

  return unionSize > 0 ? intersectionSize / unionSize : 0;
}

function getTaskStaleDays(task, now) {
  const timestamps = [task?.updatedAt, task?.createdAt, task?.lastRemindedAt]
    .map((value) => getFiniteTime(value))
    .filter(Number.isFinite);
  const latestTime = timestamps.length > 0 ? Math.max(...timestamps) : NaN;

  if (!Number.isFinite(latestTime)) {
    return 0;
  }

  return Math.floor((now.getTime() - latestTime) / (24 * 60 * 60 * 1000));
}

function getSuggestionTaskSummary(task) {
  return {
    id: task.id,
    title: task.title || "",
    status: task.status || "todo",
    priority: task.priority || "normal",
    dueAt: task.dueAt || "",
    owner: task.owner || "",
  };
}

function getPrimaryMergeTask(tasks) {
  const priorityScore = { high: 0, normal: 1, low: 2 };

  return tasks
    .slice()
    .sort((a, b) => {
      const priorityDelta = (priorityScore[a.priority] ?? 1) - (priorityScore[b.priority] ?? 1);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const dueA = a.dueAt ? getFiniteTime(a.dueAt) : Number.MAX_SAFE_INTEGER;
      const dueB = b.dueAt ? getFiniteTime(b.dueAt) : Number.MAX_SAFE_INTEGER;
      const dueSortA = Number.isFinite(dueA) ? dueA : Number.MAX_SAFE_INTEGER;
      const dueSortB = Number.isFinite(dueB) ? dueB : Number.MAX_SAFE_INTEGER;

      if (dueSortA !== dueSortB) {
        return dueSortA - dueSortB;
      }

      const updatedA = getFiniteTime(a.updatedAt || a.createdAt);
      const updatedB = getFiniteTime(b.updatedAt || b.createdAt);

      return (Number.isFinite(updatedB) ? updatedB : 0) - (Number.isFinite(updatedA) ? updatedA : 0);
    })[0];
}

export function createTaskOrganizingSuggestions(tasks, now = new Date()) {
  const activeTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => task?.id && isActiveTask(task));
  const duplicateGroups = [];
  const similarGroups = [];
  const staleTasks = [];
  const usedSimilarTaskIds = new Set();
  const tasksByExactTitle = new Map();

  for (const task of activeTasks) {
    const key = normalizeTaskTitleExactKey(task.title);

    if (key.length >= 2) {
      tasksByExactTitle.set(key, [...(tasksByExactTitle.get(key) || []), task]);
    }

    const staleDays = getTaskStaleDays(task, now);

    if (staleDays >= staleTaskThresholdDays) {
      staleTasks.push({
        task: getSuggestionTaskSummary(task),
        days: staleDays,
        reason: `${staleDays} 天没有更新，建议确认是否继续推进。`,
      });
    }
  }

  for (const group of tasksByExactTitle.values()) {
    if (group.length < 2) {
      continue;
    }

    const primaryTask = getPrimaryMergeTask(group);
    const duplicateTasks = group.filter((task) => task.id !== primaryTask.id);

    duplicateGroups.push({
      id: `duplicate:${primaryTask.id}:${duplicateTasks.map((task) => task.id).join(":")}`,
      primaryTask: getSuggestionTaskSummary(primaryTask),
      tasks: group.map(getSuggestionTaskSummary),
      duplicateTaskIds: duplicateTasks.map((task) => task.id),
      reason: "标题几乎完全一致，建议保留一条主任务，其他任务标记为已取消。",
    });

    for (const task of group) {
      usedSimilarTaskIds.add(task.id);
    }
  }

  for (let leftIndex = 0; leftIndex < activeTasks.length; leftIndex += 1) {
    const leftTask = activeTasks[leftIndex];

    if (usedSimilarTaskIds.has(leftTask.id)) {
      continue;
    }

    const group = [leftTask];

    for (let rightIndex = leftIndex + 1; rightIndex < activeTasks.length; rightIndex += 1) {
      const rightTask = activeTasks[rightIndex];

      if (usedSimilarTaskIds.has(rightTask.id)) {
        continue;
      }

      const similarity = getTitleSimilarity(leftTask.title, rightTask.title);

      if (similarity >= mergeableSimilarityThreshold && similarity < 1) {
        group.push(rightTask);
      }
    }

    if (group.length < 2) {
      continue;
    }

    const primaryTask = getPrimaryMergeTask(group);
    const mergeTaskIds = group.filter((task) => task.id !== primaryTask.id).map((task) => task.id);

    similarGroups.push({
      id: `similar:${primaryTask.id}:${mergeTaskIds.join(":")}`,
      primaryTask: getSuggestionTaskSummary(primaryTask),
      tasks: group.map(getSuggestionTaskSummary),
      mergeTaskIds,
      reason: "标题高度相似，建议合并上下文后只保留一条主任务。",
    });

    for (const task of group) {
      usedSimilarTaskIds.add(task.id);
    }
  }

  return {
    generatedAt: now.toISOString(),
    thresholds: {
      staleDays: staleTaskThresholdDays,
      similarity: mergeableSimilarityThreshold,
    },
    duplicateGroups: duplicateGroups.slice(0, 6),
    similarGroups: similarGroups.slice(0, 6),
    staleTasks: staleTasks
      .sort((a, b) => b.days - a.days)
      .slice(0, 8),
  };
}

export function createDailyReport(tasks, logs, range = "today", now = new Date()) {
  const scopedLogs = filterLogsByRange(logs, range, now);
  const activeTasks = tasks.filter((task) => isActiveTask(task));
  const todayKey = getLocalDateKey(now);
  const todayCompletedTaskIds = new Set(
    logs
      .filter((log) => log.action === "完成任务" && getLocalDateKey(log.createdAt) === todayKey)
      .map((log) => log.taskId)
      .filter(Boolean),
  );
  const completedTasks = tasks.filter((task) => {
    const completedAtTime = task?.completedAt ? getFiniteTime(task.completedAt) : NaN;

    return (
      todayCompletedTaskIds.has(task.id) ||
      getTaskCompletionsForDate(task, now).length > 0 ||
      (task.status === "done" &&
        Number.isFinite(completedAtTime) &&
        getLocalDateKey(completedAtTime) === todayKey)
    );
  });
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
