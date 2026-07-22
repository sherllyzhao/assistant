export const SYNC_SCHEMA_VERSION = 3;

export const priorities = [
  { value: "high", label: "高优先级", reminderMinutes: 15 },
  { value: "normal", label: "普通", reminderMinutes: 30 },
  { value: "low", label: "低优先级", reminderMinutes: 60 },
];

const emptySettings = {
  soundEnabled: true,
  externalConnections: [],
};

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : NaN;
}

export function normalizeSyncData(data) {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks : [],
    candidates: Array.isArray(data?.candidates) ? data.candidates : [],
    logs: Array.isArray(data?.logs) ? data.logs : [],
    vaultItems: Array.isArray(data?.vaultItems) ? data.vaultItems : [],
    tools: Array.isArray(data?.tools) ? data.tools : [],
    habits: Array.isArray(data?.habits) ? data.habits : [],
    vaultCandidates: Array.isArray(data?.vaultCandidates) ? data.vaultCandidates : [],
    tombstones: Array.isArray(data?.tombstones) ? data.tombstones : [],
    settings: {
      ...emptySettings,
      ...(data?.settings && typeof data.settings === "object" ? data.settings : {}),
    },
  };
}

export function normalizeSyncEnvelope(value) {
  return {
    schemaVersion: Number.parseInt(value?.schemaVersion || SYNC_SCHEMA_VERSION, 10),
    revision: Math.max(0, Number.parseInt(value?.revision || 0, 10)),
    updatedAt: String(value?.updatedAt || ""),
    deviceId: String(value?.deviceId || ""),
    checksum: String(value?.checksum || ""),
    data: normalizeSyncData(value?.data || value),
  };
}

export function isActiveTask(task) {
  return !["done", "cancelled"].includes(task?.status);
}

export function getPriorityMeta(priority) {
  return priorities.find((item) => item.value === priority) || priorities[1];
}

export function getTaskReminderAt(task) {
  const dueTime = parseTime(task?.dueAt);

  if (!Number.isFinite(dueTime)) {
    return "";
  }

  return new Date(dueTime - getPriorityMeta(task.priority).reminderMinutes * 60 * 1000).toISOString();
}

export function getTaskReminderWindow(task) {
  const startTime = parseTime(task?.reminderStartAt);
  const endTime = parseTime(task?.reminderEndAt);

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return { reminderStartAt: "", reminderEndAt: "" };
  }

  return {
    reminderStartAt: new Date(startTime).toISOString(),
    reminderEndAt: new Date(endTime).toISOString(),
  };
}

export function createTask(draft, now = new Date()) {
  const title = String(draft?.title || "").trim();

  if (!title) {
    throw new Error("任务标题不能为空");
  }

  const createdAt = now.toISOString();
  return {
    id: createId("task"),
    title,
    source: String(draft?.source || "手机速记").trim(),
    owner: String(draft?.owner || "").trim(),
    workDomain: String(draft?.workDomain || "other"),
    createdAt,
    updatedAt: createdAt,
    dueAt: draft?.dueAt ? new Date(draft.dueAt).toISOString() : "",
    reminderStartAt: draft?.reminderStartAt || "",
    reminderEndAt: draft?.reminderEndAt || "",
    dailySlots: [],
    dailyTarget: 0,
    completionRecords: [],
    dailySlotReminderRecords: [],
    priority: getPriorityMeta(draft?.priority).value,
    status: draft?.status || "todo",
    waitingFor: String(draft?.waitingFor || "").trim(),
    followUpAt: "",
    followUpNote: "",
    followUpDraft: "",
    lastFollowUpRemindedAt: "",
    completedAt: "",
    tags: [],
    note: String(draft?.note || "").trim(),
    launchAction: { type: "none", target: "" },
    attachments: [],
    lastRemindedAt: "",
  };
}
