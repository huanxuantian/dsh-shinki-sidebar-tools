# dsh-shinki-sidebar-tools

DSH 右侧边栏增强（纯客户端、零注入）：

1. **tab 条可滚动**：原样式是 `overflow-x:auto` 但 `scrollbar-width:none` + `touch-action:none`（能滚却看不见、摸不着）。
   本插件加**可见细滚动条**并放开触摸平移，支持触控板两指 / 滚轮 / Shift+滚轮 / 拖滚动条。
2. **「+」右键创建视图**：在 strip 控件区（含 `+`、分屏、面板控件）**右键**弹出「创建视图」菜单，
   列出**已注册视图**（尝试从 `ctx.sidebarRightTabs` 枚举）与**内置视图**，点击即 `ctx.sidebarRight.openTab(kind)` 创建。
3. **指南入口**：额外往 `sidebar.right.tab.guide.entry` 注入一个「创建视图」列表（`+` 打开的就是指南）。

## 原理

| 能力 | 手段 |
|---|---|
| 滚动 | 注入 CSS 覆盖 `[class*="_stripTabs_"]`（用类名片段而非哈希全名，构建变更后依然命中） |
| 右键菜单 | 捕获阶段监听 `contextmenu`，命中 `[class*="stripChrome"]` 时自绘菜单（纯 DOM，不依赖 React） |
| 视图清单 | 优先枚举 `sidebarRightTabs`（`items/defs/types/registry`），失败则用内置清单 |
| 容错 | 零注入 + `ctx.get()`；任何失败只 `console.warn`，不影响宿主启动 |

## 配置

内置视图清单在 `lib/client.js` 的 `BUILTIN_VIEWS`（默认含 `dsh-shinki-music` → 「音乐播放器」）。

## 路线图：接替 dsh-better-sidebar 的部分能力

### 背景与动机

`dsh-better-sidebar` 是**第三方插件**（当前 `0.24.1`）。实际使用中发现两类问题：

1. **版本兼容风险**：它提供的 `betterSidebar` 服务是若干插件（本插件、`dsh-shinki-music`、
   `dsh-shinki-git-graph`、`dsh-shinki-serial-monitor` 等）激活时的依赖项；第三方版本变动会导致
   这些插件 `pending (waiting for service: betterSidebar)` 而**整块视图不可用**。
2. **能力缺口**：官方右侧边栏存在"**视图被挤掉、横向无法滚动、看不到目标视图**"的可达性问题
   —— 本插件的横向滚动支持与 `≡ 全部视图` 菜单，正是为补这个缺口而做，而这部分能力
   **不应由一个第三方插件来决定有无**。

### 目标

让本插件成为**可自足**的替代路径：在**禁用 `dsh-better-sidebar`** 的情况下，
与之相关的视图仍能通过**本插件 + 官方 `sidebarRight`** 打开并正常使用。

### 计划（渐进、每步可回退）

| 步 | 内容 | 判定 |
|---|---|---|
| 1 | 固化本插件能力：横向滚动、`≡` 全部视图（已打开 / 可创建）、菜单边界自适应 | 不依赖任何第三方即可工作 |
| 2 | 为"下方面板/视图入口"提供**自实现**的等效形态（不再只靠 `betterSidebar.registerTab`） | 音乐播放器可从本插件入口打开 |
| 3 | 打开视图的路径改为：**官方 `sidebarRight.openTab` 优先** → `betterSidebar` 仅作最后兜底 | 官方路径可用时不触碰第三方 |
| 4 | 在 profile 中把 `dsh-better-sidebar` 标为**可选**，禁用后回归上述判定 | 禁用后各插件视图仍可用 |
| 5 | 逐个评估依赖它的插件（music / git-graph / serial-monitor / svn-graph），切换或保留 | 无 `pending`、无功能缺失 |

### 现状（已具备的基础）

- 打开视图：`sidebarRight.openTab` 优先，`betterSidebar` 的方法名探测**仅作兜底**（5 处引用，全部在兜底分支）
- 视图发现：**动态**读官方注册表 `sidebarRightTabs.entries()`，硬编码清单只在枚举失败时兜底
- 与 `dsh-shinki-music` **无强依赖**（双向审计通过）：音乐插件自带四个入口，本插件也可独立工作
