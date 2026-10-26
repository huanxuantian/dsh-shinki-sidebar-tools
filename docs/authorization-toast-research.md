# 授权请求系统弹窗（右下角浮层）实现调研

> 目标：把 DSH 的**授权请求**（`approval/asked`，例如工具执行前要用户确认）以「系统右下角弹出小悬浮窗」的形式展示；
> 停留一段时间自动消失，最多同时保留 N 条（默认 3，可配置），新条目从**下方**进入并把旧条目**上推**；
> 每条带按钮，点击后打开实例并切换到对应会话；作为 `dsh-shinki-sidebar-tools` 的**可选组件**，默认不开启。

---

## 1. 结论先行

| 方案 | 能否做到"系统级" | 能否点击切会话 | 插件可实现 | 结论 |
|---|---|---|---|---|
| **A. 应用内右下角浮层**（client 插件渲染，`position:fixed`） | 否（局限在 DSH 窗口内） | ✅ 直接调客户端 `openSession` | ✅ 纯前端 | **推荐作为主实现** |
| B. OS 原生通知（Windows 通知中心） | ✅ | ⚠️ 点击只能聚焦窗口，切会话需主进程配合 | ⚠️ 需 Electron 主进程或外部工具 | 作为可选增强 |
| C. 独立无边框 Electron 子窗口（真正"右下角常驻小窗"） | ✅ | ✅（与主窗口 IPC） | ❌ 插件拿不到主进程 | 只能由桌面壳实现 |
| D. 外部托盘程序（WinForms/Tauri 常驻） | ✅ | ✅（通过 HTTP 调 DSH） | ✅ 但属于另一个程序 | 重，不走插件 |

**判断**：DSH 插件运行在宿主进程（Node）与 Web 前端，**没有 Electron 主进程权限**，因此插件侧只能做到
「**应用内浮层**（A）」+「可选系统通知（B）」。真正"任何情况下都在系统右下角显示"需要改桌面壳（C）。

建议落地 **A 为主体，B 作为后续可选开关**。

---

## 2. 交互规格（按你的要求）

```
位置：屏幕右下角（应用内浮层：窗口右下角；多显示器时取当前窗口所在屏）
数量：最多 N 条（默认 3，可配置 1..10），超出时最旧的先消失
顺序：新条目从下方进入，旧条目整体上推（类似 toast 堆栈）
停留：默认 8 秒（可配置 3..60 秒）；鼠标悬停暂停计时
按钮：主按钮「查看」→ 打开/聚焦 DSH 实例并切到该会话；次按钮「拒绝/允许」按授权类型可选
消重：同一会话同一请求 id 只显示一次；已处理（approved/denied/expired）自动移除
隐私：默认只显示"工具名 + 会话标题 + 时间"，不显示完整参数；可配置显示摘要
```

---

## 3. 数据源

授权请求来自会话事件流（实测会话日志中存在）：

```json
{"type":"approval/asked","data":{"id":"...","toolName":"pwsh","callId":"...","reason":"escalation ..."}}
{"type":"approval/policy","data":{"policy":"ask"}}
```

实现要点：

- **host 半边**订阅会话事件（与知识库/串口插件同源的 `session/event`、`agent/*` 钩子机制），
  过滤 `approval/asked`，抽取 `{requestId, sessionId, sessionTitle, toolName, reason, at}`；
- 维护**环形缓冲**（长度 = max + 1），通过插件路由 `GET /shinki-sidebar-tools/approvals?since=` 暴露；
- **client 半边**用短轮询（1–2s）或 SSE 拉取增量，渲染浮层；
- 请求被处理后（`approval/resolved` 或工具结果返回），host 标记为 resolved，client 移除或置灰。

> 待确认点（实施时验证）：`approval/asked` 在宿主侧是否对所有会话可见（多会话并行时），
> 以及"处理结果"事件的准确类型。可用 `session/event` 通配订阅 + 事件名过滤兜底。

---

## 4. 架构

```
┌────────────── DSH host（Node）──────────────┐
│ session/event ──► approval collector        │
│                    │ 环缓冲(max+1)          │
│                    ▼                        │
│        GET /shinki-sidebar-tools/approvals  │  (loopback only)
└────────────────────┬────────────────────────┘
                     │ 轮询/SSE
┌────────────────────▼────────────────────────┐
│ DSH Web 前端（sidebar-tools client）        │
│  <ApprovalToasts enabled max dwell>         │
│   fixed bottom-right + flex-column-reverse  │
│   点击「查看」→ openSession(sessionId)      │
└─────────────────────────────────────────────┘
```

### 4.1 堆叠与动画

- 容器：`position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column-reverse;`
  —— 新条目 append 到列表尾部（视觉在下），旧的被顶上去；
- 进入：`translateY(8px) + opacity 0 → 1`；离场：`opacity → 0` 后移除（不占位）；
- 超过 N 条：从**头部**（最旧）移除；
- 悬停暂停：`onMouseEnter` 停 dwell 计时，离开重新计时。

### 4.2 点击切会话

- 客户端已存在会话切换能力（`openSession`，DSH 官方 client 包里出现该 API）；
- 浮层按钮调用 `openSession(sessionId)`；如当前窗口不在前台，先尝试聚焦（应用内浮层天然在前台，OS 通知需额外能力）；
- 切过去后可选：滚动/高亮对应审批条（会话内已有审批 UI）。

### 4.3 配置（`<plugin-data>/sidebar-tools/toast.json`）

```json
{
  "enabled": false,          // 默认关闭
  "maxVisible": 3,           // 1..10
  "dwellMs": 8000,           // 3000..60000
  "position": "bottom-right",
  "showReason": true,        // 是否显示审批原因摘要
  "systemNotification": false, // 可选：同时发 OS 通知（Windows）
  "clickAction": "switch-session"
}
```

设置页放在 sidebar-tools 的配置区，改动即时生效（client 每次拉取配置）。

---

## 5. 可选增强：真正的系统通知

| 途径 | 可行性 | 限制 |
|---|---|---|
| Chromium `Notification` API（渲染进程） | 高 | 需要用户授权通知；点击事件只能聚焦窗口，切会话要自己处理；Windows 上显示在通知中心 |
| Electron `new Notification()`（主进程） | 需改桌面壳 | 插件无法创建主进程窗口/通知 |
| PowerShell `BurntToast` / WinRT toast | 中 | 依赖外部模块；点击回调需注册协议 URL（`dsh://session/...`）并让壳处理 |
| 独立托盘小窗（Tauri/WinForms） | 高但重 | 变成另一个常驻程序，需与 DSH 通信 |

结论：**系统通知只作为"提醒"，点击切会话仍回到应用内浮层**；若要完全"系统右下角常驻小窗"，需要桌面壳支持（不在插件范围内）。

---

## 6. 实施计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1** | host 采集 `approval/asked` + 环缓冲 + 只读路由 | 有审批时 `GET /approvals` 返回条目（含 sessionId/toolName/时间） |
| **M2** | client 浮层：右下角、最多 3 条、新在下/旧上推、自动消失、悬停暂停 | 连续触发 5 次审批，屏幕上最多 3 条且顺序正确 |
| **M3** | 点击「查看」→ `openSession` 切会话；已处理自动移除 | 点按钮后到对应会话；处理完弹窗消失 |
| **M4** | 配置项（enabled/maxVisible/dwellMs/showReason）+ 设置页开关（默认关） | 改配置即时生效；默认关闭 |
| **M5（可选）** | OS 通知开关（Chromium Notification） | 窗口最小化时也能收到提醒 |

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 多标签页重复弹 | 用 `localStorage` 记录已展示 requestId + 单一 leader 实例（参照音乐插件的 leader 选主） |
| 弹窗过于打扰 | 默认关闭；`dwellMs` 可调；同类请求合并计数（"3 个待审批"） |
| 会话切换 API 不稳定 | 抽象成 `switchSession(id)`，内部先试 `openSession`，失败回退 `location.hash`/路由跳转 |
| 隐私泄露（弹窗显示参数） | 默认只显示工具名与原因摘要，截断 60 字；可关 |
| 审批已超时 | host 侧按 `at + timeout` 过期清理；client 收到 resolved 立即移除 |

## 8. 不做的事

- 不修改 DSH 桌面壳（不创建 Electron 窗口）；
- 不在插件里自动批准/拒绝授权（只做提醒与跳转）；
- 不持久化审批历史（只保留内存环缓冲，重启即清空）。

## 9. 已实现行为修正（2026-10-26）

用户反馈："右下角授权提示有时莫名显示多个，历史的已经点击查看了；提示的会话如果就是当前会话就不要弹。"

三处根因与修法：

| 现象 | 根因 | 修法 |
|---|---|---|
| 历史的已看过仍弹 | 宿主 feed 是**内存环缓冲**，页面刷新后仍在；client 的 `seen` 是内存 Set，刷新即丢 | `localStorage 'dsh-shinki-toast:seen:v1'` 持久化已展示 id（上限 400）；另外**页面加载时刻之前**的审批（`at < startedAt-5s`）一律不再弹 |
| 同一审批弹多个 | 事件缺 `requestId` 时旧实现用 `Date.now()` 拼 id ⇒ 重复派发得到不同 id | 改用稳定指纹 `会话\|工具\|理由`；宿主 `seen` 不再在环缓冲淘汰时删除（旧 id 重发不会再次入列） |
| 当前会话也弹 | 未比较 sessionId | 轮询时取当前会话键（`sessionKeyOf(ctx) || sessionKeyNow`）；相等的条目不弹（"查看"也仍在，只是不再以浮层出现）；取不到当前会话时该轮不处理，避免误弹 |

仍然是：**只提醒、不批准**；最多 `maxVisible` 条；点击"查看"切会话，点"关闭"或悬停超时消失。

自检：`node tools/verify-approvals.mjs`（同 id 重复、缺 id 重复、环缓冲淘汰后重发、dispose 等）。
