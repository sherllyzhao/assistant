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

export const vaultCategories = [
  { value: "website", label: "网站账号" },
  { value: "client", label: "客户系统" },
  { value: "software", label: "软件授权" },
  { value: "network", label: "网络/VPN" },
  { value: "ftp", label: "FTP/SFTP" },
  { value: "api", label: "API/Token" },
  { value: "other", label: "其他" },
];

export const DEFAULT_FTP_CLIENT_PATH = "D:\\ftp\\FlashFXP\\flashfxp.exe";

export const toolCategories = [
  { value: "script", label: "脚本" },
  { value: "cli", label: "命令行工具" },
  { value: "application", label: "应用程序" },
  { value: "library", label: "代码库" },
  { value: "document", label: "文档" },
  { value: "other", label: "其他" },
];

export const emptyToolDraft = {
  name: "",
  path: "",
  description: "",
  category: "other",
};

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

export function getToolCategoryMeta(category) {
  return toolCategories.find((item) => item.value === category) || toolCategories[toolCategories.length - 1];
}

export function createTool(draft, now = new Date()) {
  const name = String(draft?.name || "").trim();
  const path = String(draft?.path || "").trim();

  if (!name) {
    throw new Error("工具名称不能为空");
  }

  if (!path) {
    throw new Error("工具路径不能为空");
  }

  return {
    id: createId("tool"),
    name,
    path,
    description: String(draft?.description || "").trim(),
    category: toolCategories.some((opt) => opt.value === draft?.category) ? draft.category : "other",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function normalizeTool(item) {
  if (!item?.id) {
    return null;
  }

  return {
    id: String(item.id),
    name: String(item.name || "").trim(),
    path: String(item.path || "").trim(),
    description: String(item.description || "").trim(),
    category: toolCategories.some((opt) => opt.value === item?.category) ? item.category : "other",
    createdAt: item?.createdAt || new Date().toISOString(),
    updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
  };
}

export function normalizeTools(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeTool(item)).filter(Boolean);
}

export const emptyTaskDraft = {
  title: "",
  source: "手动录入",
  owner: "",
  dueAt: "",
  reminderStartAt: "",
  reminderEndAt: "",
  dailyTarget: 0,
  dailySlotValues: [],
  priority: "normal",
  status: "todo",
  tags: "",
  note: "",
  launchAction: emptyLaunchAction,
  attachments: [],
};

export const emptyVaultDraft = {
  title: "",
  category: "website",
  username: "",
  password: "",
  url: "",
  note: "",
  tags: "",
};

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function getVaultCategoryMeta(category) {
  return vaultCategories.find((item) => item.value === category) || vaultCategories[vaultCategories.length - 1];
}

export function maskSecretValue(value, visibleStart = 2, visibleEnd = 2) {
  const cleanValue = String(value || "");

  if (!cleanValue) {
    return "";
  }

  if (cleanValue.length <= visibleStart + visibleEnd + 1) {
    return "•".repeat(Math.max(cleanValue.length, 4));
  }

  return `${cleanValue.slice(0, visibleStart)}${"•".repeat(6)}${cleanValue.slice(-visibleEnd)}`;
}

export function createVaultPlaintext(draft) {
  return {
    username: String(draft?.username || "").trim(),
    password: String(draft?.password || ""),
    url: String(draft?.url || "").trim(),
    note: String(draft?.note || "").trim(),
  };
}

export function normalizeVaultItem(item) {
  const encrypted = item?.encrypted && typeof item.encrypted === "object" ? item.encrypted : {};
  const category = vaultCategories.some((option) => option.value === item?.category) ? item.category : "other";

  return {
    id: item?.id || createId("vault"),
    title: String(item?.title || "").trim(),
    category,
    tags: normalizeTags(item?.tags),
    usernameHint: String(item?.usernameHint || "").trim(),
    createdAt: item?.createdAt || new Date().toISOString(),
    updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
    lastViewedAt: item?.lastViewedAt || "",
    encrypted: {
      version: String(encrypted.version || "v1"),
      algorithm: String(encrypted.algorithm || "AES-GCM"),
      kdf: String(encrypted.kdf || "PBKDF2-SHA-256"),
      iterations: Number.parseInt(encrypted.iterations || "210000", 10),
      salt: String(encrypted.salt || ""),
      iv: String(encrypted.iv || ""),
      ciphertext: String(encrypted.ciphertext || ""),
    },
  };
}

export function normalizeVaultItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeVaultItem(item))
    .filter((item) => item.title && item.encrypted.salt && item.encrypted.iv && item.encrypted.ciphertext);
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
  const clock = parseClockEntriesFromText(text)[0];

  return clock ? { hour: clock.hour, minute: clock.minute } : null;
}

function parseClockEntriesFromText(text) {
  const clockText = String(text || "");
  const clockPattern =
    /(凌晨|早上|上午|中午|下午|晚上|今晚)?\s*(\d{1,2})(?:(?:[:：](\d{2}))|(?:点(?:(半)|(\d{1,2})分?)?))/g;
  const entries = [];
  let match;

  while ((match = clockPattern.exec(clockText))) {
    const meridiem = match[1] || "";
    const hour = normalizeClockHour(Number.parseInt(match[2], 10), meridiem);
    const minute = match[3] ? Number.parseInt(match[3], 10) : match[4] ? 30 : Number.parseInt(match[5] || "0", 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      entries.push({
        hour,
        minute,
        meridiem,
        index: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  return entries;
}

function applyFallbackMeridiem(clock, fallbackMeridiem) {
  if (!clock || clock.meridiem || !fallbackMeridiem) {
    return clock;
  }

  const normalizedHour = normalizeClockHour(clock.hour, fallbackMeridiem);

  return {
    ...clock,
    hour: normalizedHour,
  };
}

function hasExplicitDateHint(text) {
  return /今天|今日|今晚|明天|明日|后天|周|星期|礼拜|月底|月末|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]?|(?:\d{4}[-/.])?\d{1,2}[-/.]\d{1,2}/.test(
    String(text || ""),
  );
}

function getReminderWindowDateBase(text, now) {
  return (
    parseNumericDateDueAt(text, now) ||
    parseMonthDateDueAt(text, now) ||
    parseWeekdayDueAt(text, now) ||
    parseRelativeDueAt(text, now) ||
    parseWeekRangeDueAt(text, now) ||
    parseMonthEndDueAt(text, now) ||
    now
  );
}

function parseReminderWindowFromText(text, now) {
  const cleanText = String(text || "").trim();

  if (!cleanText) {
    return null;
  }

  const clocks = parseClockEntriesFromText(cleanText);

  for (let index = 0; index < clocks.length - 1; index += 1) {
    const startClock = clocks[index];
    const endClock = applyFallbackMeridiem(clocks[index + 1], startClock.meridiem);
    const gap = cleanText.slice(startClock.endIndex, endClock.index);

    if (!/^\s*(?:到|至|--?|－|—|–|~|～)\s*$/.test(gap)) {
      continue;
    }

    const dateBase = getReminderWindowDateBase(cleanText, now);
    let startAt = setLocalTime(dateBase, startClock.hour, startClock.minute);
    let endAt = setLocalTime(dateBase, endClock.hour, endClock.minute);

    if (endAt.getTime() <= startAt.getTime()) {
      endAt = addLocalDays(endAt, 1);
    }

    if (!hasExplicitDateHint(cleanText) && endAt.getTime() <= now.getTime()) {
      startAt = addLocalDays(startAt, 1);
      endAt = addLocalDays(endAt, 1);
    }

    return {
      reminderStartAt: startAt.toISOString(),
      reminderEndAt: endAt.toISOString(),
    };
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
  const reminderWindow = parseReminderWindowFromText(cleanText, now);
  const dueAt = reminderWindow?.reminderEndAt ? new Date(reminderWindow.reminderEndAt) : inferDueAtFromText(cleanText, now);
  const owner = inferContactFromText(cleanText);

  return {
    dueAt: isValidDate(dueAt) ? dueAt.toISOString() : "",
    reminderStartAt: reminderWindow?.reminderStartAt || "",
    reminderEndAt: reminderWindow?.reminderEndAt || "",
    owner,
    priority: inferPriorityFromTextAndDueAt(cleanText, dueAt, now),
    tags: owner ? ["客户"] : [],
  };
}

export function applyTaskIntelligence(draft, now = new Date()) {
  const text = getDraftIntelligenceText(draft);
  const intelligence = inferTaskIntelligence(text, now);
  const reminderWindow = normalizeReminderWindow(
    draft?.reminderStartAt || intelligence.reminderStartAt,
    draft?.reminderEndAt || intelligence.reminderEndAt,
  );
  const dueAt = draft?.dueAt || intelligence.dueAt || reminderWindow.reminderEndAt;
  const dueAtDate = dueAt ? new Date(dueAt) : null;
  const priority =
    draft?.priority && draft.priority !== "normal"
      ? draft.priority
      : inferPriorityFromTextAndDueAt(text, dueAtDate, now);

  return {
    ...draft,
    dueAt,
    ...reminderWindow,
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

export function normalizeReminderWindow(startAt, endAt) {
  const startTime = startAt ? getFiniteTime(startAt) : NaN;
  const endTime = endAt ? getFiniteTime(endAt) : NaN;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return {
      reminderStartAt: "",
      reminderEndAt: "",
    };
  }

  return {
    reminderStartAt: new Date(startTime).toISOString(),
    reminderEndAt: new Date(endTime).toISOString(),
  };
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
    reminderStartAt: smartDraft.reminderStartAt || "",
    reminderEndAt: smartDraft.reminderEndAt || "",
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

export function getTaskReminderWindow(task) {
  return normalizeReminderWindow(task?.reminderStartAt, task?.reminderEndAt);
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
  const reminderWindow = getTaskReminderWindow(task);
  const hasReminderWindow = Boolean(reminderWindow.reminderStartAt && reminderWindow.reminderEndAt);
  const fallbackStartTime = getFiniteTime(task?.createdAt || task?.updatedAt);
  const reminderStartTime = hasReminderWindow
    ? getFiniteTime(reminderWindow.reminderStartAt)
    : task?.dueAt
    ? getFiniteTime(getTaskReminderAt(task))
    : fallbackStartTime + reminderInterval;
  const reminderEndTime = hasReminderWindow ? getFiniteTime(reminderWindow.reminderEndAt) : Number.POSITIVE_INFINITY;
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

  if (nowTime > reminderEndTime) {
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
  const start = startOfLocalDay(now);

  if (range === "today") {
    // 今天：当前日期的 00:00:00
    // start 已经是 startOfLocalDay，不需要修改
  } else if (range === "week") {
    // 本周：从周一 00:00:00 开始
    const weekStart = getLocalWeekStart(now);
    start.setDate(weekStart.getDate());
    start.setMonth(weekStart.getMonth());
    start.setFullYear(weekStart.getFullYear());
  } else if (range === "month") {
    // 本月：从1号 00:00:00 开始
    start.setDate(1);
  }

  const startTime = start.getTime();
  return logs.filter((log) => {
    const logTime = getFiniteTime(log.createdAt);
    return Number.isFinite(logTime) && logTime >= startTime;
  });
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
  const similarityCache = new Map();

  // 快速相似度查询（带缓存）
  const getCachedSimilarity = (leftTitle, rightTitle) => {
    const key = [leftTitle, rightTitle].sort().join("||");
    if (similarityCache.has(key)) {
      return similarityCache.get(key);
    }
    const similarity = getTitleSimilarity(leftTitle, rightTitle);
    similarityCache.set(key, similarity);
    return similarity;
  };

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

  // O(n²)相似度比较，但用缓存和早停策略优化
  for (let leftIndex = 0; leftIndex < activeTasks.length; leftIndex += 1) {
    const leftTask = activeTasks[leftIndex];

    if (usedSimilarTaskIds.has(leftTask.id)) {
      continue;
    }

    const group = [leftTask];

    // 只与后续任务比较（不重复）
    for (let rightIndex = leftIndex + 1; rightIndex < activeTasks.length; rightIndex += 1) {
      const rightTask = activeTasks[rightIndex];

      if (usedSimilarTaskIds.has(rightTask.id)) {
        continue;
      }

      const similarity = getCachedSimilarity(leftTask.title, rightTask.title);

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

function endOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function isWithinLocalDay(value, day) {
  const time = getFiniteTime(value);

  if (!Number.isFinite(time)) {
    return false;
  }

  const start = startOfLocalDay(day).getTime();
  const end = endOfLocalDay(day).getTime();
  return time >= start && time <= end;
}

function endOfLocalWeek(value) {
  const end = addLocalDays(getLocalWeekStart(value), 7);
  end.setMilliseconds(end.getMilliseconds() - 1);
  return end;
}

function getAssistantPriorityRank(priority) {
  return { high: 0, normal: 1, low: 2 }[priority] ?? 1;
}

function getAssistantDueTime(task) {
  const dueTime = getFiniteTime(task?.dueAt);
  return Number.isFinite(dueTime) ? dueTime : Number.MAX_SAFE_INTEGER;
}

function sortAssistantTasksByFocus(left, right) {
  const priorityDelta = getAssistantPriorityRank(left.priority) - getAssistantPriorityRank(right.priority);

  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const dueDelta = getAssistantDueTime(left) - getAssistantDueTime(right);

  if (dueDelta !== 0) {
    return dueDelta;
  }

  const updatedLeft = getFiniteTime(left.updatedAt || left.createdAt);
  const updatedRight = getFiniteTime(right.updatedAt || right.createdAt);
  return (Number.isFinite(updatedRight) ? updatedRight : 0) - (Number.isFinite(updatedLeft) ? updatedLeft : 0);
}

function getAssistantQuestionIntent(query, keywords) {
  const question = String(query || "").trim();

  if (!question) {
    return "overview";
  }

  if (/帮助|怎么用|能做什么|你会什么|使用说明|help/i.test(question)) {
    return "help";
  }

  if (/日报|周报|月报|总结|复盘|最近做了|今天做了|本周做了|完成了|已完成|做完|这周做了/.test(question)) {
    return "report";
  }

  if (/逾期|过期|风险|来不及|最急|紧急|催办|提醒|危险|有问题/.test(question)) {
    return "risk";
  }

  if (/明天|明日|明儿|下一个/.test(question)) {
    return "tomorrow";
  }

  if (/等待|他人|对方|回复|反馈|等他/.test(question)) {
    return "waiting";
  }

  if (/长期|很久|停滞|卡住|拖了|推进|没动/.test(question)) {
    return "stale";
  }

  if (/截止|到期|时间|什么时候|哪天|排期|日程|安排|时间线/.test(question)) {
    return "schedule";
  }

  // 关键词搜索优先级提高，但要求既有关键词又有状态指示
  if (keywords.length > 0 && /(未完成|没完成|待办|还没做|还没有做|进行中|没做完|没有完成)/.test(question)) {
    return "active-search";
  }

  if (/(本周|这周|周|星期)/.test(question) && /(重要|重点|优先|安排|事情|事项|任务|做什么|该做)/.test(question)) {
    return "week";
  }

  if (/先做|现在.*(?:做|干)|该.*(?:做|干)|接下来|优先|最重要|重点|重要|现在应该|应该先/.test(question)) {
    return "focus";
  }

  if (/(今天|今日|还剩|还有|没完成|未完成|待办)/.test(question)) {
    return "today";
  }

  // progress意图：有关键词且问"进展/情况"
  if (keywords.length > 0 && /进展|情况|怎么样|如何|什么情况/.test(question)) {
    return "progress";
  }

  return "overview";
}

function extractAssistantKeywords(query) {
  const cleaned = String(query || "")
    .toLowerCase()
    .replace(
      /(sherlly|ai|工作台|有没有|有无|是否|没有|今天|今日|明天|明日|本周|这周|本月|这个月|还有|还剩|什么|哪些|哪个|怎么|怎样|如何|进展|重点|重要|事情|事项|任务|待办|未完成|没完成|完成|情况|一下|帮我|看看|查看|分析|统计|列表|列出|给我|告诉我|最|的|了|吗|呢|吧|有|是|和|与|及|回复|反馈|跟进)/g,
      " ",
    )
    .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, " ");

  return Array.from(new Set(cleaned.split(/\s+/).filter((keyword) => keyword.length >= 2))).slice(0, 4);
}

function getTaskSearchText(task) {
  return [
    task?.title,
    task?.owner,
    task?.source,
    task?.note,
    ...(Array.isArray(task?.tags) ? task.tags : []),
  ]
    .join(" ")
    .toLowerCase();
}

function getLogSearchText(log) {
  return [log?.action, log?.taskTitle, log?.detail].join(" ").toLowerCase();
}

function matchesAssistantKeywords(value, keywords) {
  const text = String(value || "").toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function addAssistantKeyword(candidates, keyword) {
  const cleanKeyword = String(keyword || "").trim().toLowerCase();

  if (cleanKeyword.length >= 2 && !candidates.includes(cleanKeyword)) {
    candidates.push(cleanKeyword);
  }
}

function addAssistantNgrams(candidates, value) {
  const cleanValue = String(value || "")
    .toLowerCase()
    .replace(/[【】"'“”‘’、，,。.!！?？:：;；()[\]（）<>《》\s]/g, "");

  if (cleanValue.length < 2) {
    return;
  }

  addAssistantKeyword(candidates, cleanValue);

  for (let size = 2; size <= Math.min(cleanValue.length, 4); size += 1) {
    for (let index = 0; index <= cleanValue.length - size; index += 1) {
      addAssistantKeyword(candidates, cleanValue.slice(index, index + size));
    }
  }
}

function getAssistantQueryTerms(query, tasks) {
  const question = String(query || "").toLowerCase();
  const terms = [...extractAssistantKeywords(question)];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    addAssistantKeyword(terms, task?.owner);

    for (const tag of Array.isArray(task?.tags) ? task.tags : []) {
      addAssistantKeyword(terms, tag);
    }

    addAssistantNgrams(terms, task?.title);

    for (const token of tokenizeTaskTitle(task?.title || "")) {
      addAssistantKeyword(terms, token);
    }
  }

  return terms.filter((term) => question.includes(term)).slice(0, 8);
}

function isTaskDueBefore(task, endTime) {
  const dueTime = getFiniteTime(task?.dueAt);
  return Number.isFinite(dueTime) && dueTime <= endTime;
}

function getTaskProjectName(task) {
  const tags = Array.isArray(task?.tags) ? task.tags : [];

  if (tags.length > 0) {
    return tags[0];
  }

  const text = `${task?.title || ""} ${task?.note || ""}`;
  const projectMatch = text.match(/客户[A-Za-z0-9\u4e00-\u9fa5]{0,8}|采购|财务|行政|报价|合同|开发|服务器|网站|证书|域名/);

  if (projectMatch) {
    return projectMatch[0];
  }

  if (task?.owner && task.owner !== "自己") {
    return task.owner;
  }

  return task?.source || "未归类";
}

function createAssistantProjectGroups(tasks, now) {
  const groups = new Map();

  for (const task of tasks) {
    const name = getTaskProjectName(task);
    const group = groups.get(name) || {
      name,
      total: 0,
      high: 0,
      overdue: 0,
      waiting: 0,
      tasks: [],
    };

    group.total += 1;
    group.high += task.priority === "high" ? 1 : 0;
    group.overdue += isOverdue(task, now) ? 1 : 0;
    group.waiting += task.status === "waiting" ? 1 : 0;
    group.tasks.push(task);
    groups.set(name, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      tasks: group.tasks.slice().sort(sortAssistantTasksByFocus).slice(0, 3),
    }))
    .sort((left, right) => right.high - left.high || right.overdue - left.overdue || right.total - left.total)
    .slice(0, 6);
}

function getWeekdayLabel(value) {
  const time = getFiniteTime(value);
  if (!Number.isFinite(time)) {
    return "未知";
  }
  const date = new Date(time);
  const localDay = date.getDay();
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][localDay];
}

function getMemoryTimestamp(task) {
  const timestamps = [task?.updatedAt, task?.completedAt, task?.createdAt, task?.dueAt]
    .map((value) => getFiniteTime(value))
    .filter(Number.isFinite);

  return timestamps.length > 0 ? Math.max(...timestamps) : 0;
}

function createEmptyMemoryStats(name) {
  return {
    name,
    total: 0,
    active: 0,
    completed: 0,
    waiting: 0,
    overdue: 0,
    high: 0,
    latestAt: 0,
    tasks: [],
  };
}

function addTaskToMemoryStats(stats, task, now) {
  stats.total += 1;
  stats.active += isActiveTask(task) ? 1 : 0;
  stats.completed += task?.status === "done" ? 1 : 0;
  stats.waiting += task?.status === "waiting" ? 1 : 0;
  stats.overdue += isOverdue(task, now) ? 1 : 0;
  stats.high += task?.priority === "high" ? 1 : 0;
  stats.latestAt = Math.max(stats.latestAt, getMemoryTimestamp(task));
  stats.tasks.push(task);
}

function sortMemoryStats(left, right) {
  return (
    right.overdue - left.overdue ||
    right.high - left.high ||
    right.active - left.active ||
    right.total - left.total ||
    right.latestAt - left.latestAt
  );
}

function finalizeMemoryStats(stats) {
  return {
    ...stats,
    latestAt: stats.latestAt ? new Date(stats.latestAt).toISOString() : "",
    tasks: stats.tasks.slice().sort(sortAssistantTasksByFocus).slice(0, 4),
  };
}

export function createWorkMemoryLibrary(tasks, now = new Date()) {
  const normalizedTasks = Array.isArray(tasks) ? tasks.filter((task) => task?.id) : [];
  const contactStats = new Map();
  const projectStats = new Map();
  const dueWeekdayStats = new Map();
  const contactTagStats = new Map();
  const staleTasks = [];

  for (const task of normalizedTasks) {
    const owner = String(task?.owner || "").trim();
    const projectName = getTaskProjectName(task);
    const tags = Array.isArray(task?.tags) ? task.tags : [];

    // 联系人统计
    if (owner) {
      const stats = contactStats.get(owner) || createEmptyMemoryStats(owner);
      addTaskToMemoryStats(stats, task, now);
      contactStats.set(owner, stats);
    }

    // 联系人 + 工作日规律
    if (owner && task?.dueAt) {
      const weekday = getWeekdayLabel(task.dueAt);
      const key = `${owner}:${weekday}`;
      const stats = dueWeekdayStats.get(key) || {
        name: owner,
        weekday,
        total: 0,
        latestAt: 0,
        tasks: [],
      };
      stats.total += 1;
      stats.latestAt = Math.max(stats.latestAt, getMemoryTimestamp(task));
      stats.tasks.push(task);
      dueWeekdayStats.set(key, stats);
    }

    // 联系人 + 标签关联
    if (owner && tags.length > 0) {
      for (const tag of tags) {
        const key = `${owner}:${tag}`;
        const count = (contactTagStats.get(key) || 0) + 1;
        contactTagStats.set(key, count);
      }
    }

    // 项目统计
    if (projectName) {
      const stats = projectStats.get(projectName) || createEmptyMemoryStats(projectName);
      addTaskToMemoryStats(stats, task, now);
      projectStats.set(projectName, stats);
    }

    // 长期未动静的任务（超过14天未更新且仍未完成）
    if (isActiveTask(task)) {
      const lastUpdateTime = getFiniteTime(task.updatedAt || task.createdAt);
      const daysSinceUpdate = (now.getTime() - lastUpdateTime) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate > 14) {
        staleTasks.push({
          task,
          daysSinceUpdate: Math.floor(daysSinceUpdate),
        });
      }
    }
  }

  const contacts = Array.from(contactStats.values())
    .sort(sortMemoryStats)
    .map((stats) => {
      const finalStats = finalizeMemoryStats(stats);
      // 找出这个联系人最常关联的标签
      const topTags = Array.from(contactTagStats.entries())
        .filter(([key]) => key.startsWith(`${stats.name}:`))
        .map(([key, count]) => ({
          tag: key.substring(stats.name.length + 1),
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 2)
        .map((item) => item.tag);
      return {
        ...finalStats,
        topTags,
      };
    })
    .slice(0, 8);

  const schedulePatterns = Array.from(dueWeekdayStats.values())
    .filter((stats) => stats.total >= 2)
    .sort((left, right) => right.total - left.total || right.latestAt - left.latestAt)
    .map((stats) => ({
      title: `${stats.name} · ${stats.weekday}`,
      name: stats.name,
      weekday: stats.weekday,
      total: stats.total,
      latestAt: stats.latestAt ? new Date(stats.latestAt).toISOString() : "",
      detail: `历史上有 ${stats.total} 条任务集中在${stats.weekday}，排期时建议提前确认。`,
      tasks: stats.tasks.slice().sort(sortAssistantTasksByFocus).slice(0, 4),
    }))
    .slice(0, 8);

  const projects = Array.from(projectStats.values())
    .sort(sortMemoryStats)
    .map(finalizeMemoryStats)
    .slice(0, 8);

  // 长期未动的预警
  const staleWarnings = staleTasks
    .sort((a, b) => b.daysSinceUpdate - a.daysSinceUpdate)
    .slice(0, 3)
    .map((item) => ({
      task: item.task,
      daysSinceUpdate: item.daysSinceUpdate,
      warning: `${item.task.title} 已经 ${item.daysSinceUpdate} 天未更新，可能需要跟进或重新评估。`,
    }));

  return {
    generatedAt: now.toISOString(),
    metrics: {
      taskSamples: normalizedTasks.length,
      contacts: contacts.length,
      schedulePatterns: schedulePatterns.length,
      projects: projects.length,
    },
    contacts,
    schedulePatterns,
    projects,
    staleWarnings,
  };
}

function createAssistantMemoryHints(tasks, now) {
  const memory = createWorkMemoryLibrary(tasks, now);
  const weekdayHints = memory.schedulePatterns.map((pattern) => ({
    title: pattern.title,
    detail: pattern.detail,
  }));

  const ownerHints = memory.contacts
    .filter((stats) => stats.total >= 2)
    .map((stats) => ({
      title: stats.name,
      detail: `累计 ${stats.total} 条相关任务，当前 ${stats.active} 条未完成。`,
    }));

  return [...weekdayHints, ...ownerHints].slice(0, 4);
}

function createAssistantLogScope(logs, range, now) {
  return filterLogsByRange(Array.isArray(logs) ? logs : [], range, now).slice().reverse().slice(0, 8);
}

function sortAssistantLogsNewestFirst(left, right) {
  const leftTime = getFiniteTime(left?.createdAt);
  const rightTime = getFiniteTime(right?.createdAt);
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

export function createAiWorkspaceAnswer(tasks, logs, query = "", now = new Date()) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];
  const normalizedLogs = Array.isArray(logs) ? logs : [];
  const activeTasks = normalizedTasks.filter((task) => task?.id && isActiveTask(task));
  const completedTasks = normalizedTasks.filter((task) => task?.status === "done");
  const overdueTasks = activeTasks.filter((task) => isOverdue(task, now));
  const waitingTasks = activeTasks.filter((task) => task.status === "waiting");
  const cleanQuery = String(query || "").trim();
  const keywords = getAssistantQueryTerms(cleanQuery, normalizedTasks);
  const intent = getAssistantQuestionIntent(query, keywords);
  const todayEndTime = endOfLocalDay(now).getTime();
  const tomorrow = addLocalDays(now, 1);
  const weekEndTime = endOfLocalWeek(now).getTime();
  const projectGroups = createAssistantProjectGroups(activeTasks, now);
  const memoryHints = createAssistantMemoryHints(normalizedTasks, now);
  const baseMetrics = {
    active: activeTasks.length,
    completed: completedTasks.length,
    overdue: overdueTasks.length,
    waiting: waitingTasks.length,
  };
  const baseTips = [
    "可以直接问：现在先做什么、有哪些风险、某个客户进展如何、明天要做什么。",
    "安全速记内容不会参与 AI 工作台分析，避免把密码类信息混进普通工作流。",
  ];

  // 生成动态风险提示
  const generateRiskTips = () => {
    const tips = [];
    if (overdueTasks.length > 0) {
      tips.push(`⚠️ 有 ${overdueTasks.length} 件已逾期任务，建议立即处理。`);
    }
    if (waitingTasks.length > 0) {
      tips.push(`⏳ 有 ${waitingTasks.length} 件等待他人反馈，可以考虑催办或寻找替代方案。`);
    }
    const dueToday = activeTasks.filter((t) => isTaskDueBefore(t, endOfLocalDay(now).getTime()) && !isOverdue(t, now));
    if (dueToday.length > 0) {
      tips.push(`📅 今天还有 ${dueToday.length} 件截止，排好执行顺序。`);
    }
    return tips.length > 0 ? tips : baseTips;
  };

  if (intent === "help") {
    return {
      intent,
      label: "使用帮助",
      title: "你可以直接用工作语言问我",
      summary: "我会根据任务标题、负责人、标签、备注和日志做本地分析。可以问优先级、风险、截止安排、项目进展、日报周报和长期未推进事项。",
      taskSectionTitle: "当前建议关注",
      metrics: baseMetrics,
      primaryTasks: activeTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
      isFallback: false,
    };
  }

  if (intent === "risk") {
    const dueSoonTasks = activeTasks.filter((task) => isTaskDueBefore(task, todayEndTime) || task.priority === "high");
    const primaryTasks = [...overdueTasks, ...dueSoonTasks, ...waitingTasks]
      .filter((task, index, list) => list.findIndex((item) => item.id === task.id) === index)
      .sort(sortAssistantTasksByFocus)
      .slice(0, 8);
    const riskScore = overdueTasks.length * 3 + waitingTasks.length * 2 + dueSoonTasks.filter(t => !isOverdue(t, now)).length;

    return {
      intent,
      label: "风险扫描",
      title: riskScore > 10 ? "⚠️ 风险较高，建议立即处理" : riskScore > 5 ? "⚠️ 存在一些风险" : "🟡 风险水平正常",
      summary: `风险评分 ${riskScore}/20。来源：${overdueTasks.length} 件逾期、${waitingTasks.length} 件等待他人回复、${dueSoonTasks.filter(t => !isOverdue(t, now)).length} 件高优先级或今日到期。`,
      taskSectionTitle: "风险任务",
      metrics: {
        ...baseMetrics,
        risky: primaryTasks.length,
      },
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "today", now),
      keywords,
      tips: generateRiskTips(),
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
      isFallback: primaryTasks.length === 0,
    };
  }

  if (intent === "focus") {
    const primaryTasks = activeTasks
      .filter((task) => task.priority === "high" || isOverdue(task, now) || isTaskDueBefore(task, todayEndTime) || task.status === "doing")
      .sort(sortAssistantTasksByFocus)
      .slice(0, 8);
    const focusTips = [];
    if (activeTasks.length > 10) {
      focusTips.push(`📊 你有 ${activeTasks.length} 件未完成任务，建议集中精力在优先级最高的 3-5 件上。`);
    }
    if (primaryTasks.length === 0) {
      focusTips.push("✅ 目前没有特别紧迫的任务，可以选择之前暂停的工作继续推进。");
    } else {
      focusTips.push(`🎯 建议按顺序处理这 ${primaryTasks.length} 件任务。`);
    }

    return {
      intent,
      label: "优先级建议",
      title: primaryTasks.length > 0 ? "🎯 现在先处理这些" : "✅ 当前没有紧迫任务",
      summary: `按逾期、优先级、截止时间和进行中状态排序。${primaryTasks.length > 0 ? `当前最值得先看的有 ${primaryTasks.length} 件。` : "你的任务优先级分布合理。"}`,
      taskSectionTitle: "优先处理",
      metrics: baseMetrics,
      primaryTasks: primaryTasks.length > 0 ? primaryTasks : activeTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "today", now),
      keywords,
      tips: focusTips.length > 0 ? focusTips : baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
      isFallback: primaryTasks.length === 0,
    };
  }

  if (intent === "tomorrow") {
    const primaryTasks = activeTasks
      .filter((task) => isWithinLocalDay(task.dueAt, tomorrow) || (!task.dueAt && task.priority === "high"))
      .sort(sortAssistantTasksByFocus)
      .slice(0, 8);
    const tomorrowTips = primaryTasks.length > 0
      ? [`📅 明天有 ${primaryTasks.length} 件任务，今天最好提前准备关键信息。`]
      : ["✅ 明天没有特别安排，可以提前规划后天的工作。"];

    return {
      intent,
      label: "明日安排",
      title: primaryTasks.length > 0 ? "📅 明天要盯住的事" : "✅ 明天日程充足",
      summary: `明天截止或适合提前安排的任务有 ${primaryTasks.length} 件；${primaryTasks.length === 0 ? "说明当前任务里没有明确的明日截止时间。" : "建议今天就完成准备工作。"}`,
      taskSectionTitle: "明日任务",
      metrics: baseMetrics,
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
      keywords,
      tips: tomorrowTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
      isFallback: primaryTasks.length === 0,
    };
  }

  if (intent === "schedule") {
    const primaryTasks = activeTasks
      .filter((task) => task.dueAt || task.reminderStartAt || task.reminderEndAt)
      .sort(sortAssistantTasksByFocus)
      .slice(0, 10);

    return {
      intent,
      label: "截止安排",
      title: primaryTasks.length > 0 ? "📅 有明确时间的任务" : "✅ 没有带截止时间的任务",
      summary: primaryTasks.length > 0
        ? `当前有 ${primaryTasks.length} 件任务带截止或提醒时间；按优先级和最近截止排序。`
        : "暂时没有任务带截止时间，可以给关键任务补上截止日期方便跟进。",
      taskSectionTitle: "时间线",
      metrics: baseMetrics,
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
      isFallback: primaryTasks.length === 0,
    };
  }

  if (intent === "report") {
    const range = /周报|本周|这周/.test(cleanQuery) ? "week" : /月报|本月|这个月/.test(cleanQuery) ? "month" : "today";
    const report = createDailyReport(normalizedTasks, normalizedLogs, range, now);
    const primaryTasks = [
      ...report.sections.completedTasks,
      ...report.sections.overdueTasks,
      ...report.sections.waitingTasks,
      ...report.sections.tomorrowFocus,
    ]
      .filter((task, index, list) => task?.id && list.findIndex((item) => item.id === task.id) === index)
      .slice(0, 8);

    return {
      intent,
      label: range === "week" ? "自动周报" : range === "month" ? "月度复盘" : "自动日报",
      title: range === "week" ? "本周工作摘要" : range === "month" ? "本月工作摘要" : "今日工作摘要",
      summary: `创建 ${report.metrics.created} 件，执行 ${report.metrics.started} 次，完成 ${report.metrics.completed} 件，当前未完成 ${report.metrics.active} 件，逾期 ${report.metrics.overdue} 件。`,
      taskSectionTitle: "摘要相关任务",
      metrics: {
        ...baseMetrics,
        logs: report.metrics.logs,
      },
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: report.sections.recentLogs,
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "active-search") {
    const matchedTasks = activeTasks.filter((task) => matchesAssistantKeywords(getTaskSearchText(task), keywords));
    const matchedTaskIds = new Set(matchedTasks.map((task) => task.id));
    const matchedLogs = normalizedLogs
      .filter((log) => matchedTaskIds.has(log.taskId) || matchesAssistantKeywords(getLogSearchText(log), keywords))
      .slice()
      .sort(sortAssistantLogsNewestFirst)
      .slice(0, 8);

    return {
      intent,
      label: "相关未完成",
      title: keywords.length > 0 ? `${keywords.join(" / ")} 的未完成事项` : "相关未完成事项",
      summary: `共找到 ${matchedTasks.length} 件相关未完成任务；这里只包含待办、进行中和等待他人的事项，不含已完成或已取消。`,
      taskSectionTitle: "相关未完成",
      metrics: {
        ...baseMetrics,
        matched: matchedTasks.length,
      },
      primaryTasks: matchedTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
      projectGroups,
      memoryHints,
      recentLogs: matchedLogs,
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "today") {
    const scopedTasks = activeTasks.filter((task) => {
      const progress = getDailyProgress(task, now);
      return isTaskDueBefore(task, todayEndTime) || progress.isScheduled || task.priority === "high";
    });
    const primaryTasks = (scopedTasks.length > 0 ? scopedTasks : activeTasks).slice().sort(sortAssistantTasksByFocus).slice(0, 8);

    return {
      intent,
      label: "今日未完成",
      title: "今天还没收口的事",
      summary: `当前未完成 ${activeTasks.length} 件，其中逾期 ${overdueTasks.length} 件、等待他人 ${waitingTasks.length} 件。优先看高优先级、今日到期和每日时段任务。`,
      taskSectionTitle: "优先处理",
      metrics: baseMetrics,
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "today", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "week") {
    const primaryTasks = activeTasks
      .filter((task) => task.priority === "high" || isTaskDueBefore(task, weekEndTime))
      .slice()
      .sort(sortAssistantTasksByFocus)
      .slice(0, 8);

    return {
      intent,
      label: "本周重点",
      title: "本周最该盯住的事",
      summary: `本周重点按高优先级和本周截止排序，共筛出 ${primaryTasks.length || activeTasks.length} 件；如果没有本周截止任务，则回退到当前未完成任务。`,
      taskSectionTitle: "本周重点",
      metrics: baseMetrics,
      primaryTasks: primaryTasks.length > 0 ? primaryTasks : activeTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "waiting") {
    const primaryTasks = waitingTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8);

    return {
      intent,
      label: "等待跟进",
      title: "卡在他人回复的事",
      summary: `当前等待他人的任务有 ${waitingTasks.length} 件；这些事项适合集中催办或补一条跟进日志。`,
      taskSectionTitle: "等待他人",
      metrics: baseMetrics,
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "stale") {
    const taskById = new Map(activeTasks.map((task) => [task.id, task]));
    const suggestions = createTaskOrganizingSuggestions(normalizedTasks, now);
    const primaryTasks = suggestions.staleTasks
      .map((item) => taskById.get(item.task.id))
      .filter(Boolean)
      .slice(0, 8);

    return {
      intent,
      label: "长期未完成",
      title: "需要重新确认的旧任务",
      summary: `发现 ${primaryTasks.length} 件长期没有更新的任务；建议确认是否继续推进、降级，或取消。`,
      taskSectionTitle: "长期未更新",
      metrics: baseMetrics,
      primaryTasks,
      projectGroups,
      memoryHints,
      recentLogs: createAssistantLogScope(normalizedLogs, "month", now),
      keywords,
      tips: baseTips,
      usedQuery: cleanQuery,
      generatedAt: now.toISOString(),
    };
  }

  if (intent === "progress") {
    const matchedTasks = keywords.length > 0
      ? normalizedTasks.filter((task) => matchesAssistantKeywords(getTaskSearchText(task), keywords))
      : normalizedTasks;
    const matchedTaskIds = new Set(matchedTasks.map((task) => task.id));
    const matchedLogs = normalizedLogs
      .filter((log) => matchedTaskIds.has(log.taskId) || matchesAssistantKeywords(getLogSearchText(log), keywords))
      .slice()
      .sort((left, right) => getFiniteTime(right.createdAt) - getFiniteTime(left.createdAt))
      .slice(0, 8);
    const activeMatchedTasks = matchedTasks.filter((task) => isActiveTask(task));
    const completedMatchedTasks = matchedTasks.filter((task) => task.status === "done");
    const isFallback = cleanQuery && keywords.length === 0;
    const fallbackTasks = activeTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8);

    return {
      intent,
      label: isFallback ? "未识别明确对象" : "进展查询",
      title: keywords.length > 0 ? `${keywords.join(" / ")} 的进展` : "我先按当前工作概览回答",
      summary: isFallback
        ? `我还没从“${cleanQuery}”里识别到联系人、项目、标签或任务关键词。先给你当前最该关注的未完成事项。`
        : `共找到 ${matchedTasks.length} 件相关任务：未完成 ${activeMatchedTasks.length} 件、已完成 ${completedMatchedTasks.length} 件、最近日志 ${matchedLogs.length} 条。`,
      taskSectionTitle: isFallback ? "建议关注" : "相关任务",
      metrics: {
        ...baseMetrics,
        matched: matchedTasks.length,
      },
      primaryTasks: isFallback ? fallbackTasks : matchedTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
      projectGroups,
      memoryHints,
      recentLogs: isFallback ? createAssistantLogScope(normalizedLogs, "week", now) : matchedLogs,
      keywords,
      tips: isFallback
        ? [
            "可以带上任务里的负责人、客户名、标签或标题关键词，例如“王总合同进展”或“报价还有哪些没做”。",
            ...baseTips,
          ]
        : baseTips,
      usedQuery: cleanQuery,
      isFallback,
      generatedAt: now.toISOString(),
    };
  }

  return {
    intent,
    label: "工作概览",
    title: "当前工作态势",
    summary: `现在有 ${activeTasks.length} 件未完成任务，${overdueTasks.length} 件逾期，${waitingTasks.length} 件等待他人。`,
    taskSectionTitle: "建议关注",
    metrics: baseMetrics,
    primaryTasks: activeTasks.slice().sort(sortAssistantTasksByFocus).slice(0, 8),
    projectGroups,
    memoryHints,
    recentLogs: createAssistantLogScope(normalizedLogs, "week", now),
    keywords,
    tips: baseTips,
    usedQuery: cleanQuery,
    generatedAt: now.toISOString(),
  };
}
