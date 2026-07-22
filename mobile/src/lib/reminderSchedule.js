import { getTaskReminderAt, getTaskReminderWindow, getPriorityMeta, isActiveTask } from "./shared.js";

const MAX_NOTIFICATIONS = 48;

export function buildTaskReminderSchedule(task, { now = new Date(), maxNotifications = MAX_NOTIFICATIONS } = {}) {
  if (!task?.id || !isActiveTask(task)) return [];

  const intervalMs = getPriorityMeta(task.priority).reminderMinutes * 60 * 1000;
  const nowTime = new Date(now).getTime();
  const window = getTaskReminderWindow(task);
  const hasWindow = Boolean(window.reminderStartAt && window.reminderEndAt);
  const startTime = new Date(hasWindow ? window.reminderStartAt : getTaskReminderAt(task)).getTime();
  const endTime = new Date(hasWindow ? window.reminderEndAt : getTaskReminderAt(task)).getTime();

  if (!Number.isFinite(nowTime) || !Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];

  const firstSlot = hasWindow
    ? startTime + Math.ceil((Math.max(startTime, nowTime) - startTime) / intervalMs) * intervalMs
    : startTime >= nowTime ? startTime : NaN;
  const schedule = [];

  if (!Number.isFinite(firstSlot)) return schedule;

  for (let timestamp = firstSlot; timestamp <= endTime && schedule.length < maxNotifications; timestamp += intervalMs) {
    schedule.push({
      id: `sherlly-task:${task.id}:${timestamp}`,
      taskId: task.id,
      title: "Sherlly 任务提醒",
      body: task.title || "有一项任务需要处理",
      date: new Date(timestamp),
    });
  }

  return schedule;
}

export function getTaskNotificationPrefix(taskId) {
  return `sherlly-task:${String(taskId || "task")}:`;
}
