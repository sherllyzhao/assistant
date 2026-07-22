import {
  getTaskReminderAt,
  getTaskReminderWindow,
  getReminderIntervalMinutes,
  isActiveTask,
} from "./domain.js";

const DEFAULT_MAX_NOTIFICATIONS = 48;

function finiteTime(value) {
  const time = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : NaN;
}

function createNotificationId(taskId, timestamp) {
  return `sherlly-task:${String(taskId || "task")}:${timestamp}`;
}

/**
 * Returns deterministic native notification slots for one task.
 * A task with an explicit reminder window repeats at the configured priority
 * interval. A task with only dueAt keeps the existing desktop behaviour and
 * schedules one lead reminder.
 */
export function buildTaskReminderSchedule(
  task,
  { now = new Date(), maxNotifications = DEFAULT_MAX_NOTIFICATIONS } = {},
) {
  if (!task?.id || !isActiveTask(task)) {
    return [];
  }

  const intervalMinutes = getReminderIntervalMinutes(task);
  const intervalMs = intervalMinutes * 60 * 1000;
  const nowTime = finiteTime(now);

  if (!Number.isFinite(nowTime) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return [];
  }

  const window = getTaskReminderWindow(task);
  const hasWindow = Boolean(window.reminderStartAt && window.reminderEndAt);
  const startTime = hasWindow ? finiteTime(window.reminderStartAt) : finiteTime(getTaskReminderAt(task));
  const endTime = hasWindow ? finiteTime(window.reminderEndAt) : startTime;

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return [];
  }

  const firstTime = Math.max(startTime, nowTime);
  const firstSlot = hasWindow
    ? startTime + Math.ceil((firstTime - startTime) / intervalMs) * intervalMs
    : startTime >= nowTime
      ? startTime
      : NaN;

  if (!Number.isFinite(firstSlot)) {
    return [];
  }
  const schedule = [];

  for (let timestamp = firstSlot; timestamp <= endTime && schedule.length < maxNotifications; timestamp += intervalMs) {
    schedule.push({
      id: createNotificationId(task.id, timestamp),
      taskId: task.id,
      title: "Sherlly 任务提醒",
      body: task.title || "有一项任务需要处理",
      date: new Date(timestamp),
      intervalMinutes,
    });
  }

  return schedule;
}

export function getTaskNotificationPrefix(taskId) {
  return `sherlly-task:${String(taskId || "task")}:`;
}
