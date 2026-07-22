import * as Notifications from "expo-notifications";
import { buildTaskReminderSchedule, getTaskNotificationPrefix } from "./reminderSchedule.js";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission() {
  const current = await Notifications.getPermissionsAsync();

  if (current.granted) {
    return current;
  }

  return Notifications.requestPermissionsAsync();
}

export async function configureNotificationChannel() {
  await Notifications.setNotificationChannelAsync("sherlly-tasks", {
    name: "Sherlly 任务提醒",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    sound: "default",
  });
}

async function cancelTaskNotifications(taskId) {
  const prefix = getTaskNotificationPrefix(taskId);
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith(prefix))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export async function scheduleTaskNotifications(task, now = new Date()) {
  await cancelTaskNotifications(task.id);
  const permission = await requestNotificationPermission();

  if (!permission.granted) {
    return [];
  }

  const schedule = buildTaskReminderSchedule(task, { now });
  const identifiers = [];

  for (const reminder of schedule) {
    const identifier = await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound: "default",
        data: { taskId: reminder.taskId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminder.date,
        channelId: "sherlly-tasks",
      },
    });
    identifiers.push(identifier);
  }

  return identifiers;
}

export { cancelTaskNotifications };
