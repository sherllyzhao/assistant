# Sherlly Assistant 设计规范

> 版本 1.0 · 适用范围：Web / Electron 渲染层（`src/styles.css`）。mobile（Expo）端后续参照本文档单独落地。
> 品牌色全部取自应用图标矢量源文件：`assets/sherlly-icon.svg`、`assets/sherlly-icon-alert.svg`、`assets/sherlly-icon-mono.svg`。

## 1. 设计原则

- **图标即品牌**：靛蓝（信任、专注）为主色，玫红为强调/警示色，石墨 `#111827` 为文字色——三者均直接来自图标源文件，界面与桌面图标观感一致。
- **60-30-10 配色比例**：约 60% 中性底色（`--bg` / 白色卡片）、30% 辅助层次（浅靛蓝面板、边框、分区），10% 强调色（按钮、链接、徽章、选中态）。强调色只给交互元素和关键状态，不做大面积铺底。
- **状态不只靠颜色**：错误/警告除颜色外必须有图标或文字（现有 lucide 图标体系继续沿用）。
- **无 emoji**：界面一切文案（含数据层生成的字符串、标题、通知）禁止使用 emoji，图形语义一律由 lucide 线性图标在渲染层承载（见第 9 节）。

## 2. 色彩系统

### 2.1 品牌色阶

| Token | 值 | 来源 |
|---|---|---|
| `--brand-500` | `#6366F1` | 图标渐变起点（sherlly-icon.svg） |
| `--brand-600` | `#4F46E5` | 图标渐变中值，= manifest `theme_color` |
| `--brand-700` | `#4338CA` | 图标渐变终点 |

### 2.2 语义 Token（`src/styles.css` `:root`）

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#F5F6FB` | 页面底色（靛蓝倾向的近白，替代旧绿灰 `#f5f7f4`） |
| `--surface` | `#FFFFFF` | 卡片、面板、输入框底 |
| `--surface-muted` | `#F3F4F6` | 次级底色、chip 底 |
| `--ink` | `#111827` | 主文字（= 单色图标底色，不用纯黑） |
| `--muted` | `#6B7280` | 次要文字（白底对比度 ≈ 4.8:1，AA） |
| `--line` | `#E5E7EB` | 边框、分割线（仅装饰，不承载文字） |
| `--accent` | `var(--brand-600)` | 主按钮、链接、图标、选中态 |
| `--accent-strong` | `var(--brand-700)` | hover 深化、强调文字 |
| `--accent-soft` | `#EEF2FF` | 选中/高亮底色、浅色徽章底 |
| `--danger` | `#E11D48` | 错误、删除、逾期（玫红，同图标警示徽章色系） |
| `--danger-soft` | `#FFF1F2` | 错误底色 |
| `--warning` / `--warning-ink` / `--warning-soft` | `#D97706` / `#92400E` / `#FFFBEB` | 待办、提醒（琥珀；文字用 `-ink`，`#D97706` 只做边框/图标） |
| `--success` | `#047857` | 完成态（祖母绿 700，保证浅绿底上文字达标） |

**半透明写法**：需要带透明度的品牌色/危险色一律写 `rgba(var(--accent-rgb), α)` / `rgba(var(--danger-rgb), α)`（通道值 `79, 70, 229` / `225, 29, 72`），禁止再出现写死的 rgb 三元组——换主题只动 `:root` 一处。

### 2.3 对比度底线（WCAG AA）

| 组合 | 对比度 | 判定 |
|---|---|---|
| 白字 on `#4F46E5`（主按钮） | ≈ 6.3:1 | AA 通过 |
| `#4338CA` on `#EEF2FF`（徽章） | ≈ 6.4:1 | AA 通过 |
| `#E11D48` on 白（错误文字） | ≈ 4.7:1 | AA 通过 |
| `#047857` on `#D1FAE5`（完成 pill） | ≈ 4.8:1 | AA 通过 |
| `#6B7280` on 白（次要文字） | ≈ 4.8:1 | AA 通过 |

新增颜色组合时按此标准自查：正文 ≥ 4.5:1，≥18px 或粗体大字 ≥ 3:1，focus 边框与背景 ≥ 3:1。

### 2.4 状态色语义映射

| 业务状态 | 色系 | 文字 / 底色 |
|---|---|---|
| 待办 todo | 琥珀 | `#92400E` / `#FEF3C7` |
| 进行中 doing | 靛蓝 | `--accent-strong` / `#E0E7FF` |
| 等待 waiting | 灰 | `#4B5563` / `#F3F4F6` |
| 完成 done | 祖母绿 | `--success` / `#D1FAE5` |
| 取消 cancelled | 灰 | `--muted` / `#F3F4F6` |
| 高优先级 / 逾期 | 玫红 | `--danger` / `--danger-soft` |

## 3. 字体排版

**字体栈**（`:root`）：`system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif`
拉丁字符与数字走 Segoe UI/系统字体，中文回落雅黑/苹方；离线优先的 Electron 应用不引入 Web Font。

**字重只用三档**（中文字体细字重可读性差，禁用 100-300；800/900 视觉过重已全量下调）：

| 字重 | 用途 |
|---|---|
| 400 | 正文、说明文字 |
| 600 | 按钮、标签、chip、强调 |
| 700 | 标题（h1-h3、strong 默认） |

**字号阶梯**（中文最小 12px，禁用 11px 及以下）：

| 字号 | 用途 |
|---|---|
| 12px | chip、meta、辅助说明（下限） |
| 13px | 次要正文、表单 label |
| 14px | 正文默认 |
| 16-18px | 面板标题（h2/h3） |
| 20px | 弹窗标题 |
| 24-30px | 页面主标题 |

正文行高 1.5（body 全局），多行说明 1.5-1.65；`.eyebrow` 类全大写小标签配 `letter-spacing: 0.08em`。

## 4. 间距

4px 基础网格：**4 / 8 / 12 / 16 / 24 / 32**。

- 组件内 padding：紧凑 8，默认 12，宽松 16
- 紧密关联元素 gap 8，字段间 12-16，区块间 16-24
- Label → 控件 6px；页面级留白走 `.app-shell`（28px 顶部）

## 5. 圆角

图标圆角比例约 22.6%（58/256），界面整体取"明显圆润"档：

| Token | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | kbd、code、缩略图、小徽章 |
| `--radius-md` | 10px | 按钮、输入框、chip 容器、列表行卡 |
| `--radius-lg` | 14px | 面板（`.panel` / `.task-area` / `.metric-card`）、banner、大卡片 |
| `--radius-xl` | 18px | 弹窗（dialog） |
| `--radius-pill` | 999px | pill 徽章、进度条 |

规则：**外层容器圆角 ≥ 内层元素圆角**（弹窗 xl > 卡片 lg > 控件 md > 小件 sm）。

## 6. 阴影

石墨/靛蓝色调阴影（不用纯黑，不再用旧绿调 `rgba(25,45,38,…)`）：

| Token | 值 | 用途 |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(17,24,39,0.05)` | 输入框、小卡 |
| `--shadow` | `0 1px 2px rgba(17,24,39,0.04), 0 12px 32px rgba(30,27,75,0.08)` | 面板、卡片默认 |
| `--shadow-lg` | `0 24px 70px rgba(17,24,39,0.22)` | 弹窗、浮层 |

## 7. 动效

- 标准过渡：`160ms ease`（background / border-color / color / transform 四件套，已有约定沿用）
- hover 位移：`translateY(-1px)`，仅用于可点击卡片与主按钮
- 入场：参考 `.reminder-alert` 的 `reminder-slide-in`（180ms ease-out，位移 + 淡入）
- 新增动画不超过 240ms；后续接入 `prefers-reduced-motion` 时统一降级

## 8. 组件规约

- **主按钮**：`--accent` 底 + 白字 + 600 字重，hover 变 `--accent-strong` 并上浮 1px；最小高度 38px（移动端 40-42px）
- **次按钮**：`--surface-muted` 底 + `--line` 边框，hover 转 `--accent-soft` + accent 边框
- **输入框**：白底、`--line` 边框、radius-md；focus 态 accent 边框 + `0 0 0 3px rgba(var(--accent-rgb), 0.12)` 光圈
- **状态 pill**：按 2.4 映射取色，600 字重、12px、pill 圆角，前置 6px 圆点
- **卡片/面板**：白底 + `--line` 边框 + `--shadow` + radius-lg；行级卡（task-row）radius-md + 5px 左侧状态条
- **banner**：浅色底（accent-soft / warning-soft / danger-soft）+ 同色系边框 + 左侧 5px 色条；**禁止深色半透明底**（旧 `.sync-status-banner` 的深板子写法已废弃）
- **空状态**：虚线边框 + `--muted` 文案 + 图标，radius-lg

## 9. 图标规范

图标库统一使用 **lucide-react**（线性 stroke 风格），不引入第二套图标库。

| 尺寸 | 用途 |
|---|---|
| 14px | 行内文字旁、meta 信息 |
| 16px | 按钮、输入框前缀、列表操作 |
| 18px | 面板/区块标题、AI 回答标题 |
| 20px | 指标卡（Metric） |
| 24px | 大卡片入口（tool-card 等） |

- 颜色默认继承文字色；功能性标题图标用 `--accent`，预警类用 `--warning`，危险操作用 `--danger`
- **禁止 emoji**：UI 文案、按钮、标题、通知、数据层字符串（如 `src/lib/domain.js` 生成的提示语）一律纯文本；需要图形语义时在渲染层放 lucide 图标（参照 App.jsx 的 `assistantIntentIcons`：按 `intent` 映射 AI 回答标题图标）
- 图标只做辅助，不替代文字：状态、警告必须有文字说明（对应 2.3 无障碍要求）

## 10. 品牌色落点清单（改主题必过一遍）

| 位置 | 内容 |
|---|---|
| `src/styles.css` `:root` | 全部语义 token（唯一真源） |
| `index.html` meta `theme-color` | `#4F46E5` |
| `public/manifest.webmanifest` | `theme_color: #4F46E5`、`background_color: #f5f6fb` |
| `electron/main.cjs` | 托盘兜底图标色（base `#4F46E5`/`#F43F5E`，alert `#E11D48`/`#FFFFFF`）、窗口 `backgroundColor: #f5f6fb` |
| `assets/sherlly-icon*.svg` + `.ico` / `public/favicon.png` | 图标源文件（色值上游） |
| `mobile/` | 未迁移，后续参照本文档 |

3.1.0 的教训：只改了 manifest、漏了 index.html 和 styles.css，导致三处 theme color 三个值——以后动品牌色，按本清单逐项过。

## 11. 参考

- ui-sites 知识库：`color-palettes/color-principles.md`（60-30-10、WCAG）、`component-design/component-fundamentals.md`（圆角/阴影/间距系统）、`typography/typography-cjk.md`（中文字号下限、字重映射、行高）
- 色值来源：`assets/sherlly-icon.svg`、`assets/sherlly-icon-alert.svg`、`assets/sherlly-icon-mono.svg`
