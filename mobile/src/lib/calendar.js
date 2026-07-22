import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Calendar from "expo-calendar";

const EVENT_KEY_PREFIX = "sherlly.mobile.calendar-event:";

function getEventKey(taskId) {
  return `${EVENT_KEY_PREFIX}${taskId}`;
}

function getEventDetails(task) {
  const start = new Date(task.reminderEndAt || task.dueAt || Date.now());
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  return {
    title: task.title || "Sherlly 任务",
    notes: task.note || "由 Sherlly Assistant 创建",
    startDate: start,
    endDate: end,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export async function requestCalendarPermission() {
  const current = await Calendar.getCalendarPermissionsAsync();

  if (current.granted) {
    return current;
  }

  return Calendar.requestCalendarPermissionsAsync();
}

async function getWritableCalendar() {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable = calendars.find((calendar) => calendar.allowsModifications !== false);

  if (!writable) {
    throw new Error("手机上没有可写入的日历账户，请先在系统日历中添加账户");
  }

  return writable;
}

export async function addTaskToCalendar(task) {
  const permission = await requestCalendarPermission();

  if (!permission.granted) {
    throw new Error("请允许 Sherlly 访问手机日历");
  }

  const details = getEventDetails(task);
  const stored = await AsyncStorage.getItem(getEventKey(task.id));
  let eventId = "";

  if (stored) {
    try {
      const mapping = JSON.parse(stored);
      eventId = mapping.eventId || "";
      if (eventId) {
        await Calendar.updateEventAsync(eventId, details);
      }
    } catch {
      eventId = "";
    }
  }

  if (!eventId) {
    const calendar = await getWritableCalendar();
    eventId = await Calendar.createEventAsync(calendar.id, details);
    await AsyncStorage.setItem(getEventKey(task.id), JSON.stringify({
      eventId,
      calendarId: calendar.id,
    }));
  }

  return eventId;
}

export async function removeTaskFromCalendar(taskId) {
  const stored = await AsyncStorage.getItem(getEventKey(taskId));

  if (!stored) {
    return false;
  }

  try {
    const mapping = JSON.parse(stored);
    if (mapping.eventId) {
      await Calendar.deleteEventAsync(mapping.eventId);
    }
  } finally {
    await AsyncStorage.removeItem(getEventKey(taskId));
  }

  return true;
}
