# 需求与实现计划：临时视图工具（sidebar_temp_view）

状态：**已实现并验证**（2026-10-20；实现细节与踩坑见 §14）
日期：2026-10-20（决策更新）

## 1. 需求

给 `dsh-shinki-sidebar-tools` 增加一个 agent 工具，让 agent 在运行时**动态注册临时视图**：

- 仅在**本次客户端运行期间**存在，重启后全部消失（不落盘、不进 manifest）；
- **仅对创建它的那个会话有效**（绑定会话；离开该会话即不显示，回来后仍在）；
- 支持**注册 / 修改 / 卸载 / 列表**；
- 卸载只允许两种：**该会话的全部临时视图**，或**指定的单个临时视图**。

用途：调试与自检（把运行状态临时渲染成视图观察）、在不发版的前提下验证布局与绑定行为。

## 2. 已确认的决策

| 项 | 决策 |
|---|---|
| **形态** | 支持现有的**全部五种**：`mini`（悬浮窗）、`right`（右侧栏）、`bottom`（底部栏）、`popup`（全屏/弹出视图）、`mainView`（会话视图 TAG 页）。`form` 可为单个或数组；默认 `mini` |
| **绑定** | 默认且**强制会话绑定**：临时视图带 `sessionId`，仅在该会话激活时渲染 |
| **标题** | 统一加前缀 **`【临时】`** + 用户给的纯文本名字（前缀由插件强制添加，工具参数里不必写） |
| **卸载** | 仅两种：`unregister(id)` 单个；`unregister(scope:'session')` 当前会话全部。**不提供**跨会话的 `'*'` |
| **内容** | 标题 + 纯文本（不接受 HTML/JS，不执行任何来自参数的内容） |

## 3. 非目标

- 不注入任意 JavaScript/HTML（只接受声明式数据）；
- 不持久化（重启即消失是硬要求）；
- 不替代正式插件的 `registerView`。

## 4. 现状与约束（关键）

本插件目前是**纯客户端**：

```
lib/index.js    300 B   （几乎无宿主逻辑）
lib/client.js   190 KB  （全部视图逻辑）
package.json    dsh.host = null（未声明宿主能力）
```

工具运行在**宿主侧**，无法直接调用客户端视图层，因此必须有 host → client 通道。

**动工前置（第 0 步）**：核实 DSH 0.2.1 中注册 HTTP 路由的服务名与签名
（`webRuntime` 已移除；老插件用 `inject:['webServer']`，0.2.1 里 `dsh-web` 以
`super(ctx,'web')` 注册）。判断错会重演"注入不满足 → 插件永不激活"。

## 5. 已核实的视图形态（源码）

`lib/client.js` 的 `VIEW_FORMS` 实际支持：

| form | 含义 | 备注 |
|---|---|---|
| `mini` | 悬浮窗 | 现有 `mini.bind` 已支持 `global`/`session`，临时视图固定 `session` |
| `right` | 右侧栏 | 走 `registerRightRail` → `sidebar.right.pane.tab` 槽 |
| `bottom` | 底部栏 | 会同时登记右侧栏入口（现有行为） |
| `popup` | 全屏/弹出视图 | `openPopupView(id)` |
| `mainView` | 会话视图 TAG 页 | `slots.inject('conversation.view')` + `slots.register` |

## 6. 架构

```
agent → 工具 sidebar_temp_view {action, ...}
      → host: lib/index.js
          1) 校验参数（声明式）
          2) 写入内存 Map<id, spec>（含 sessionId、version）
          3) version++
      → HTTP GET /plugins/<plugin>/temp-views?session=<sid>&since=<ver>
         返回 { version, views:[...仅该 session...] }
      → client: 轮询 1.5s（版本未变直接 return；document.hidden 时暂停）
          差量对齐：added→registerView；changed→dispose+register；removed→dispose
      → UI 按 form 渲染
```

轮询而非推送：实现简单、与现有风格一致；1.5s 延迟对调试足够。

## 7. 工具契约

工具名：`sidebar_temp_view`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | `register｜update｜unregister｜list` | 是 | 操作 |
| `id` | string | update/unregister 必填；register 可省略（自动 `tmp-<n>`） | 视图 id，统一 `tmp-` 前缀 |
| `title` | string | register 必填 | 纯文本名字；插件渲染时自动加 `【临时】` |
| `text` | string | 否 | 纯文本内容（等宽、多行） |
| `form` | `mini｜right｜bottom｜popup｜mainView` 或其数组 | 否 | 默认 `mini` |
| `width`/`height` | number | 否 | 仅 `mini`；受 `MINI_TIERS` 上限约束 |
| `visible` | boolean | 否 | 默认 true（仅 `mini` 有意义） |
| `scope` | `session` | unregister 时可选 | 卸载当前会话全部临时视图 |

语义：

- 临时视图**始终**绑定到调用工具时所在的会话（`sessionId` 由宿主按当前会话解析）；
- `update` 只改同一 `sessionId` 下、同 `id` 的视图；
- 若 `id` 已存在且属于**其它会话**，拒绝并返回明确错误（避免跨会话污染）。

返回：`{ ok, id?, version, scope?, error? }`；`list` 额外返回 `views[]`。

## 8. 宿主内存模型

```js
const TEMP = {
  version: 0,
  views: new Map(),   // id -> { id, sessionId, title, text, form, width, height, visible, version }
};
```

- 进程重启即清空（满足"临时"）；
- 单 agent 场景无需锁；并发写以最后写入为准（文档标注）；
- 提供 `list` 便于 agent 幂等判断。

## 9. 客户端对齐

- 仅渲染 `sessionId === 当前会话` 的临时视图；
- 会话切换时：把不属于新会话的临时视图 `dispose()`（数据仍留在宿主，切回时重新出现）；
- `id` 冲突（与正式视图同名）→ 拒绝注册并告警；
- `form` 为数组时，逐个 `impl(ctx, spec)`（与现有 `registerView` 一致）；
- 临时视图的 `title` 在 `titleOf()` 层统一加 `【临时】` 前缀。

## 10. 安全

- 只接受字符串/数字/布尔/枚举；
- 文本按纯文本渲染，不解析 HTML/Markdown；
- 尺寸上限沿用 `MINI_TIERS`；
- 不写文件、不写 localStorage。

## 11. 实现步骤与验收

| 步 | 内容 | 验收 |
|---|---|---|
| 0 | 核实 0.2.1 路由注册接口 | 最小路由 `curl` 返回 JSON |
| 1 | host：内存 store + 工具 + 路由（按 session 过滤） | `register` 后 `curl?session=...` 可见 |
| 2 | client：轮询 + 差量对齐（mini 先行） | 工具注册后 UI 出现；unregister 后消失 |
| 3 | 其余形态：`right`/`bottom`/`popup`/`mainView` | 每种形态都能注册与卸载 |
| 4 | 会话隔离 | A 注册的视图在 B 不可见；切回 A 仍在 |
| 5 | `update` 生效 | 标题/文本/尺寸改变无需重启 |
| 6 | 卸载语义 | 单个 / 当前会话全部；跨会话拒绝 |
| 7 | 重启验证 | 重启后全部消失 |
| 8 | 文档与清单 | README 用法；manifest 重算 + `verify-install` |

## 12. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 0.2.1 路由接口判断错 | 插件不激活 | 步 0 先验证 |
| 多形态注册的副作用 | 例如 `bottom` 会顺带登记右侧栏入口 | 文档标注；必要时为临时视图跳过该副作用 |
| 轮询开销 | 轻微 | 版本号短路 + 页面隐藏暂停 |
| 未卸载的临时视图残留 | 到重启为止 | `list` 可见 + `scope:'session'` 一键清理 |

## 13. 决策记录

- 2026-10-20：确认支持全部五种形态；临时视图强制会话绑定且仅当前会话有效；
  标题自动加 `【临时】` 前缀；卸载仅限"单个"或"当前会话全部"。

## 14. 实现与验证记录（2026-10-20）

### 已实现

| 文件 | 作用 |
|---|---|
| `lib/temp-views-store.js` | 内存 store（`version` + `Map`），按 `sessionId` 归属；`register/update/unregister/snapshot` |
| `lib/temp-views-tool.js` | `sidebar_temp_view` 工具；会话 id 取自 `exec.agent.id` |
| `lib/index.js` | `inject = ['webServer','tools']`；只读路由 `/shinki-sidebar-temp/{views,diag}` |
| `lib/client.js` | 1.5s 轮询 + 差量对齐；标题加 `【临时】`；mini 固定 `bind:'session'` |

### 端到端验证

```
GET /shinki-sidebar-temp/diag
→ {"services":{"tools":true,"webServer":true},
   "tool":{"registered":true,"error":null},"version":1}
调用 sidebar_temp_view(register, title=测试A, text=hello, form=mini)
→ 界面出现悬浮视图，内容 hello
GET /shinki-sidebar-temp/views?session=probe → {"views":[]}   （会话隔离正确）
```

### 三个必须记住的契约/坑

1. **`defineTool` 必须提供 `output.render`**，否则注册直接失败：
   `Cannot read properties of undefined (reading 'render')`。
2. **`output.schema` 必须是标准 JSON Schema**（`{type:'object', properties:{…}}`），
   扁平"字段名→schema"会被拒：`unsupported JSON schema: schema.type must be ...`。
   列表类结果建议序列化成字符串字段（本项目用 `viewsText`），避免 array/nested 校验问题。
3. **工具会热刷新进已有会话**（DSH 有 `toolsChanged`），不必新建会话；
   但宿主侧代码只在客户端启动时加载，改 `lib/index.js` 必须重启客户端。

### 诊断端点

`GET /shinki-sidebar-temp/diag` 返回注入状态、工具注册结果与错误、版本号、
`lastPollSession`（客户端轮询用的会话键）与 `sessionsWithViews`（有视图的键），
用于判断"工具没注册"与"会话键不一致"这两类问题。

## 15. 几何（位置/尺寸）与诊断（2026-10-20 补充）

### 参数

`register` / `update` 均支持 `x`、`y`（视口绝对坐标，px）与 `width`、`height`（px）。
不传则不修改；临时视图属会话绑定，几何随会话状态保存，重启后不保留。

### 实现要点（踩过的三个坑）

1. **必须先写状态、再 miniShow**：`miniShow` 内部会调用 `miniApplyGeometry`，
   若状态里没有 x/y 就会走默认锚点（右下角），把先前写的样式覆盖掉。
2. **注册分支必须也调用应用几何**：早期只在 update 分支调用，导致"注册时位置永远在右下角"，
   而 update 后才生效 —— 表现为"位置总是默认、只有改的时候才跳"。
3. **同 id 更新必须原地重渲染**：`dispose + registerView` 在 mini 单例里会叠出第二份视图；
   改为把数据放 `TEMP_VIEWS.data`，按 id 读取并重渲染。

### 实测数据（/diag 的 lastReport）

```json
want : {"x":500,"y":300,"w":420,"h":260}
inline   : {"left":"500px","top":"300px","width":"420px","height":"420px"}
computed : {"position":"fixed","left":"500px","top":"300px"}
rect : {"x":500,"y":300,"w":420,"h":260}
```

`rect` 与 `want` 逐项一致 → 位置尺寸生效；只改文本时 `rect` 不变 → 几何保持。

### 诊断开关

`POST /shinki-sidebar-temp/report` 与 `/diag` 的 `lastReport` 用于定位几何问题；
客户端默认**不回传**，需在 prefs 里置 `debugGeometry: true` 才启用。