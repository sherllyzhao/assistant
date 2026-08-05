import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView as ContextSafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Notifications from "expo-notifications";
import { createTask, getPriorityMeta, getTaskReminderWindow, isActiveTask, normalizeSyncData, priorities } from "./src/lib/shared.js";
import { addTaskToCalendar, requestCalendarPermission } from "./src/lib/calendar.js";
import { getStoredAuth, login, register } from "./src/lib/api.js";
import { clearStoredAuth } from "./src/lib/authStorage.js";
import { configureNotificationChannel, requestNotificationPermission, scheduleTaskNotifications } from "./src/lib/notifications.js";
import { loadCurrentData, saveCurrentData } from "./src/lib/api.js";

const emptyData = normalizeSyncData({ tasks: [] });

function formatDate(value) {
  if (!value) return "未设置时间";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function parseDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function getTaskSortTime(task) {
  const date = new Date(task.dueAt || task.reminderEndAt || task.updatedAt || 0).getTime();
  return Number.isFinite(date) ? date : Number.MAX_SAFE_INTEGER;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [auth, setAuth] = useState(null);
  const [data, setData] = useState(emptyData);
  const [revision, setRevision] = useState(0);
  const [screen, setScreen] = useState("home");
  const [editorTask, setEditorTask] = useState(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    Promise.all([getStoredAuth(), configureNotificationChannel()])
      .then(async ([storedAuth]) => {
        if (!mounted) return;
        setAuth(storedAuth);
        if (storedAuth) {
          await refreshData();
        }
      })
      .catch((error) => mounted && setMessage(error.message))
      .finally(() => mounted && setBooting(false));

    return () => {
      mounted = false;
    };
  }, []);

  async function refreshData() {
    const envelope = await loadCurrentData();
    setData(envelope.data);
    setRevision(envelope.revision);
    await scheduleAllNotifications(envelope.data.tasks);
  }

  async function scheduleAllNotifications(tasks) {
    const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(isActiveTask);
    await Promise.all(activeTasks.map((task) => scheduleTaskNotifications(task).catch(() => [])));
  }

  async function handleAuth(mode, credentials) {
    setBusy(true);
    setMessage("");
    try {
      const nextAuth = mode === "register"
        ? await register(credentials.username, credentials.password, credentials.displayName)
        : await login(credentials.username, credentials.password);
      setAuth(nextAuth);
      await refreshData();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function persistData(nextData) {
    setBusy(true);
    setMessage("");
    try {
      const envelope = await saveCurrentData(nextData, revision);
      setData(envelope.data);
      setRevision(envelope.revision);
      await scheduleAllNotifications(envelope.data.tasks);
      return envelope.data;
    } catch (error) {
      setMessage(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTask(draft) {
    const now = new Date();
    const nextTask = draft.id
      ? {
        ...draft,
        updatedAt: now.toISOString(),
        dueAt: draft.dueAt || "",
        reminderStartAt: draft.reminderStartAt || "",
        reminderEndAt: draft.reminderEndAt || "",
      }
      : createTask(draft, now);
    const nextData = {
      ...data,
      tasks: draft.id ? data.tasks.map((task) => (task.id === draft.id ? nextTask : task)) : [nextTask, ...data.tasks],
    };

    await persistData(nextData);
    setEditorTask(null);
    setScreen("home");
  }

  async function handleComplete(task) {
    const now = new Date().toISOString();
    const nextData = {
      ...data,
      tasks: data.tasks.map((item) => item.id === task.id
        ? { ...item, status: "done", completedAt: now, updatedAt: now }
        : item),
    };

    try {
      await persistData(nextData);
    } catch (error) {
      Alert.alert("完成任务失败", error?.message || "网络异常，请稍后重试");
    }
  }

  async function handleCalendar(task) {
    try {
      await addTaskToCalendar(task);
      Alert.alert("已加入手机日历", `${task.title} 已创建或更新。`);
    } catch (error) {
      Alert.alert("加入日历失败", error.message);
    }
  }

  if (booting) {
    return <LoadingView />;
  }

  if (!auth) {
    return <AuthScreen busy={busy} message={message} onSubmit={handleAuth} />;
  }

  return (
    <ContextSafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} translucent={false} />
      <View style={styles.appHeader}>
        <View>
          <Text style={styles.brand}>Sherlly</Text>
          <Text style={styles.subtitle}>{auth.user?.displayName || auth.user?.username || "工作事项助理"}</Text>
        </View>
        {busy ? <ActivityIndicator color={colors.accent} /> : null}
      </View>

      {message ? <Notice text={message} /> : null}

      <View style={styles.content}>
        {screen === "home" ? (
          <HomeScreen
            tasks={data.tasks}
            onAdd={() => setEditorTask({})}
            onEdit={setEditorTask}
            onComplete={handleComplete}
            onCalendar={handleCalendar}
          />
        ) : (
          <SettingsScreen
            onRefresh={async () => {
              try {
                await refreshData();
                setMessage("同步完成");
              } catch (error) {
                setMessage(error.message);
              }
            }}
            onNotifications={async () => {
              const permission = await requestNotificationPermission();
              Alert.alert("通知权限", permission.granted ? "已允许任务提醒" : "通知权限未开启");
            }}
            onCalendar={async () => {
              const permission = await requestCalendarPermission();
              Alert.alert("日历权限", permission.granted ? "已允许写入手机日历" : "日历权限未开启");
            }}
            onLogout={async () => {
              await clearStoredAuth();
              setAuth(null);
              setData(emptyData);
              setRevision(0);
            }}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        <TabButton label="任务" active={screen === "home"} onPress={() => setScreen("home")} />
        <Pressable style={styles.addButton} onPress={() => setEditorTask({})} accessibilityLabel="新增任务" hitSlop={10}>
          <Text style={styles.addButtonText}>+</Text>
        </Pressable>
        <TabButton label="设置" active={screen === "settings"} onPress={() => setScreen("settings")} />
      </View>

      {editorTask ? (
        <TaskEditor
          task={editorTask.id ? editorTask : null}
          onClose={() => setEditorTask(null)}
          onSave={handleSaveTask}
        />
      ) : null}
    </ContextSafeAreaView>
  );
}

function LoadingView() {
  return <ContextSafeAreaView style={styles.loading}><ActivityIndicator size="large" color={colors.accent} /><Text style={styles.muted}>正在打开 Sherlly…</Text></ContextSafeAreaView>;
}

function Notice({ text }) {
  return <View style={styles.notice}><Text style={styles.noticeText}>{text}</Text></View>;
}

function AuthScreen({ busy, message, onSubmit }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  return (
    <ContextSafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.authCard}>
          <Text style={styles.authLogo}>Sherlly</Text>
          <Text style={styles.authTitle}>{mode === "login" ? "登录你的工作空间" : "创建 Sherlly 账号"}</Text>
          <Text style={styles.authHint}>手机提醒由系统通知负责，不依赖浏览器标签页。</Text>
          {mode === "register" ? <TextInput style={styles.input} placeholder="显示名称" value={displayName} onChangeText={setDisplayName} /> : null}
          <TextInput style={styles.input} placeholder="账号" autoCapitalize="none" value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} placeholder="密码" secureTextEntry value={password} onChangeText={setPassword} />
          {message ? <Notice text={message} /> : null}
          <Pressable style={styles.primaryButton} disabled={busy} onPress={() => onSubmit(mode, { username, password, displayName })}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{mode === "login" ? "登录" : "注册"}</Text>}
          </Pressable>
          <Pressable onPress={() => setMode(mode === "login" ? "register" : "login")}>
            <Text style={styles.linkText}>{mode === "login" ? "还没有账号？创建一个" : "已有账号？返回登录"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ContextSafeAreaView>
  );
}

function HomeScreen({ tasks, onAdd, onEdit, onComplete, onCalendar }) {
  const activeTasks = useMemo(() => tasks.filter(isActiveTask).sort((a, b) => getTaskSortTime(a) - getTaskSortTime(b)), [tasks]);
  const doneCount = tasks.filter((task) => task.status === "done").length;

  return (
    <View style={styles.screen}>
      <View style={styles.homeTitleRow}>
        <View><Text style={styles.screenTitle}>今天</Text><Text style={styles.muted}>{activeTasks.length} 项待处理 · {doneCount} 项已完成</Text></View>
        <Pressable style={styles.smallButton} onPress={onAdd}><Text style={styles.smallButtonText}>快速记录</Text></Pressable>
      </View>
      <FlatList
        data={activeTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={activeTasks.length ? styles.list : styles.emptyList}
        renderItem={({ item }) => <TaskCard task={item} onEdit={onEdit} onComplete={onComplete} onCalendar={onCalendar} />}
        ListEmptyComponent={<EmptyHome onAdd={onAdd} />}
      />
    </View>
  );
}

function TaskCard({ task, onEdit, onComplete, onCalendar }) {
  const window = getTaskReminderWindow(task);
  return (
    <View style={styles.taskCard}>
      <Pressable style={styles.taskMain} onPress={() => onEdit(task)}>
        <View style={styles.taskTitleRow}><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.priority}>{getPriorityMeta(task.priority).label}</Text></View>
        <Text style={styles.taskMeta}>{task.dueAt ? `截止 ${formatDate(task.dueAt)}` : "未设置截止时间"}</Text>
        {window.reminderStartAt ? <Text style={styles.reminderMeta}>持续提醒：{formatDate(window.reminderStartAt)} - {formatDate(window.reminderEndAt)}</Text> : null}
        {task.note ? <Text style={styles.taskNote} numberOfLines={2}>{task.note}</Text> : null}
      </Pressable>
      <View style={styles.taskActions}>
        <Pressable style={styles.actionButton} onPress={() => onComplete(task)}><Text style={styles.actionText}>完成</Text></Pressable>
        <Pressable style={styles.actionButton} onPress={() => onCalendar(task)}><Text style={styles.actionText}>日历</Text></Pressable>
      </View>
    </View>
  );
}

function EmptyHome({ onAdd }) {
  return <View style={styles.emptyState}><Text style={styles.emptyTitle}>今天还没有待办</Text><Text style={styles.muted}>把第一件事记下来，Sherlly 会按时间提醒你。</Text><Pressable style={styles.primaryButton} onPress={onAdd}><Text style={styles.primaryButtonText}>新增任务</Text></Pressable></View>;
}

function TaskEditor({ task, onClose, onSave }) {
  const [title, setTitle] = useState(task?.title || "");
  const [note, setNote] = useState(task?.note || "");
  const [priority, setPriority] = useState(task?.priority || "normal");
  const [dueAt, setDueAt] = useState(parseDateInput(task?.dueAt) || new Date(Date.now() + 60 * 60 * 1000));
  const [hasReminder, setHasReminder] = useState(Boolean(task?.reminderStartAt || task?.reminderEndAt || task?.dueAt));
  const [reminderEndAt, setReminderEndAt] = useState(parseDateInput(task?.reminderEndAt) || dueAt);
  const [picker, setPicker] = useState(null);
  const [saving, setSaving] = useState(false);
  const interval = getPriorityMeta(priority).reminderMinutes;
  const reminderStartAt = new Date(reminderEndAt.getTime() - interval * 60 * 1000);

  // Android 不支持 mode="datetime"（会退化成仅日期），拆成 date -> time 两步。
  function openPicker(field) {
    setPicker({ field, stage: Platform.OS === "ios" ? "datetime" : "date" });
  }

  function handlePickerChange(event, date) {
    if (!picker) return;

    if (!date || event?.type === "dismissed") {
      setPicker(null);
      return;
    }

    const isDue = picker.field === "due";
    const base = isDue ? dueAt : reminderEndAt;
    const setValue = isDue ? setDueAt : setReminderEndAt;

    if (picker.stage === "date") {
      const merged = new Date(date);
      merged.setHours(base.getHours(), base.getMinutes(), 0, 0);
      setValue(merged);
      setPicker({ field: picker.field, stage: "time" });
      return;
    }

    if (picker.stage === "time") {
      const merged = new Date(base);
      merged.setHours(date.getHours(), date.getMinutes(), 0, 0);
      setValue(merged);
    } else {
      setValue(date);
    }

    setPicker(null);
  }

  async function submit() {
    if (!title.trim()) {
      Alert.alert("还差一步", "请填写任务标题");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        ...(task || {}),
        title: title.trim(),
        note: note.trim(),
        priority,
        status: task?.status || "todo",
        dueAt: dueAt?.toISOString() || "",
        reminderStartAt: hasReminder ? reminderStartAt.toISOString() : "",
        reminderEndAt: hasReminder ? reminderEndAt.toISOString() : "",
      });
    } catch (error) {
      // 顶部的 Notice 会被弹层遮挡，必须用 Alert 直接告知失败原因。
      Alert.alert("保存失败", error?.message || "网络异常，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.modalBackdrop}>
      <KeyboardAvoidingView style={styles.modalKeyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.editorCard}>
          <View style={styles.modalHeader}><Text style={styles.modalTitle}>{task ? "编辑任务" : "新增任务"}</Text><Pressable onPress={onClose}><Text style={styles.closeText}>关闭</Text></Pressable></View>
          <ScrollView contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>任务标题</Text>
            <TextInput style={styles.input} placeholder="例如：确认合同进度" value={title} onChangeText={setTitle} />
            <Text style={styles.label}>备注</Text>
            <TextInput style={[styles.input, styles.multiline]} placeholder="补充上下文（可选）" value={note} onChangeText={setNote} multiline />
            <Text style={styles.label}>优先级与提醒间隔</Text>
            <View style={styles.choiceRow}>{priorities.map((item) => <Choice key={item.value} active={priority === item.value} label={`${item.label} ${item.reminderMinutes}分钟`} onPress={() => setPriority(item.value)} />)}</View>
            <Text style={styles.label}>截止时间</Text>
            <Pressable style={styles.dateButton} onPress={() => openPicker("due")}><Text style={styles.dateText}>{formatDate(dueAt)}</Text></Pressable>
            <View style={styles.switchRow}><Text style={styles.label}>持续提醒直到截止</Text><Switch value={hasReminder} onValueChange={setHasReminder} trackColor={{ true: colors.accent }} /></View>
            {hasReminder ? <Text style={styles.reminderHint}>将从 {formatDate(reminderStartAt)} 开始，每 {interval} 分钟提醒一次。</Text> : null}
            {hasReminder ? <Pressable style={styles.dateButton} onPress={() => openPicker("reminderEnd")}><Text style={styles.dateText}>提醒结束：{formatDate(reminderEndAt)}</Text></Pressable> : null}
            {picker ? <DateTimePicker value={picker.field === "due" ? dueAt : reminderEndAt} mode={picker.stage} onChange={handlePickerChange} /> : null}
            <Pressable style={styles.primaryButton} disabled={saving} onPress={submit}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>保存任务</Text>}</Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Choice({ active, label, onPress }) {
  return <Pressable style={[styles.choice, active && styles.choiceActive]} onPress={onPress}><Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text></Pressable>;
}

function SettingsScreen({ onRefresh, onNotifications, onCalendar, onLogout }) {
  return (
    <ScrollView contentContainerStyle={styles.settingsScreen}>
      <Text style={styles.screenTitle}>设置</Text>
      <Text style={styles.muted}>手机通知和系统日历都由原生能力管理，不依赖浏览器标签页。</Text>
      <View style={styles.settingsGroup}>
        <SettingRow title="通知权限" description="允许 Sherlly 在 App 关闭时提醒任务" action="检查并开启" onPress={onNotifications} />
        <SettingRow title="手机日历" description="把任务直接写入 iOS / Android 日历" action="检查并开启" onPress={onCalendar} />
        <SettingRow title="云端同步" description="重新读取电脑端和手机端的最新任务" action="立即同步" onPress={onRefresh} />
      </View>
      <Pressable style={styles.secondaryButton} onPress={onLogout}><Text style={styles.secondaryButtonText}>退出登录</Text></Pressable>
    </ScrollView>
  );
}

function SettingRow({ title, description, action, onPress }) {
  return <View style={styles.settingRow}><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.muted}>{description}</Text></View><Pressable onPress={onPress}><Text style={styles.linkText}>{action}</Text></Pressable></View>;
}

function TabButton({ label, active, onPress }) {
  return <Pressable style={styles.tabButton} onPress={onPress}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}

const colors = {
  bg: "#f5f8f6",
  surface: "#ffffff",
  ink: "#18302a",
  muted: "#6d7e78",
  line: "#dce8e2",
  accent: "#12715f",
  accentSoft: "#e0f0ea",
  danger: "#c94738",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  appHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { color: colors.accent, fontSize: 27, fontWeight: "800" },
  authLogo: { color: colors.accent, fontSize: 34, fontWeight: "900", marginBottom: 10 },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  screen: { flex: 1, paddingHorizontal: 16 },
  screenTitle: { color: colors.ink, fontSize: 25, fontWeight: "800" },
  homeTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  list: { paddingBottom: 24, gap: 10 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  taskCard: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14 },
  taskMain: { gap: 6 },
  taskTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  taskTitle: { flex: 1, color: colors.ink, fontSize: 17, fontWeight: "800" },
  priority: { color: colors.accent, backgroundColor: colors.accentSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3, fontSize: 11, fontWeight: "700" },
  taskMeta: { color: colors.muted, fontSize: 13 },
  reminderMeta: { color: colors.accent, fontSize: 12 },
  taskNote: { color: colors.ink, lineHeight: 19, fontSize: 13 },
  taskActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 10 },
  actionButton: { borderColor: colors.line, borderWidth: 1, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 12 },
  actionText: { color: colors.accent, fontWeight: "700", fontSize: 12 },
  smallButton: { backgroundColor: colors.accentSoft, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8 },
  smallButtonText: { color: colors.accent, fontWeight: "800", fontSize: 12 },
  tabBar: { height: 70, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingBottom: Platform.OS === "ios" ? 12 : 0 },
  tabButton: { width: 84, alignItems: "center", padding: 12 },
  tabText: { color: colors.muted, fontWeight: "700" },
  tabTextActive: { color: colors.accent },
  // 不使用负 margin 悬浮：Android 上超出父容器边界的区域收不到触摸事件（react-native#28894）。
  addButton: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, justifyContent: "center", alignItems: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, elevation: 4 },
  addButtonText: { color: "#fff", fontSize: 30, lineHeight: 32, fontWeight: "300" },
  loading: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", gap: 12 },
  muted: { color: colors.muted, lineHeight: 19, fontSize: 13 },
  notice: { marginHorizontal: 16, marginBottom: 10, padding: 10, borderRadius: 8, backgroundColor: "#fff0ed", borderWidth: 1, borderColor: "#f1c4bd" },
  noticeText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  emptyState: { alignItems: "center", padding: 24, gap: 10 },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  authWrap: { flex: 1, justifyContent: "center", padding: 22 },
  authCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 22, borderWidth: 1, borderColor: colors.line },
  authTitle: { color: colors.ink, fontSize: 22, fontWeight: "800", marginBottom: 8 },
  authHint: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 20 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 8, paddingHorizontal: 12, color: colors.ink, backgroundColor: "#fbfdfc", marginBottom: 11, fontSize: 15 },
  multiline: { minHeight: 80, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { minHeight: 46, borderRadius: 8, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 8 },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryButton: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, marginTop: 18 },
  secondaryButtonText: { color: colors.ink, fontWeight: "800" },
  linkText: { color: colors.accent, textAlign: "center", fontWeight: "700", marginTop: 16 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15, 36, 29, 0.38)", zIndex: 10 },
  modalKeyboard: { flex: 1, justifyContent: "flex-end" },
  editorCard: { maxHeight: "92%", backgroundColor: colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 16 },
  modalHeader: { paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modalTitle: { color: colors.ink, fontSize: 20, fontWeight: "800" },
  closeText: { color: colors.accent, fontWeight: "700" },
  editorContent: { padding: 18, paddingBottom: 30 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "800", marginBottom: 7, marginTop: 6 },
  choiceRow: { flexDirection: "row", gap: 7, marginBottom: 12 },
  choice: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 7, paddingVertical: 9, alignItems: "center" },
  choiceActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  choiceText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  choiceTextActive: { color: colors.accent },
  dateButton: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: 8, justifyContent: "center", paddingHorizontal: 12, marginBottom: 12 },
  dateText: { color: colors.ink, fontSize: 14 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  reminderHint: { color: colors.accent, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  settingsScreen: { padding: 18, paddingBottom: 32 },
  settingsGroup: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, marginTop: 20 },
  settingRow: { minHeight: 76, padding: 14, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  settingCopy: { flex: 1, gap: 4 },
  settingTitle: { color: colors.ink, fontWeight: "800", fontSize: 15 },
});
