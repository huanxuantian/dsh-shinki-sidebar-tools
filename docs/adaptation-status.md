# 适配进度（现状快照）

> 快照时间：2026-10-06 · 对应提交 `b65681c`（功能）与 `cdd4cb8`（工具）· 契约版本 `CONTRACT_VERSION = 2`
> **本文是"当前实际状态"的出处**；README 的 §实现进度 / §形态→实现 / §待办 已按本文收敛。
> 逐条踩坑细节见 `docs/reference-bottom-panel.md` §6–§8。

## 0. 运行环境（本机实测）

| 项 | 值 |
|---|---|
| profile | `data/dsh/profiles/shinki-desktop`（bundles 含本插件与全部消费方） |
| 官方侧 | `@deepseek-ai/dsh-base` / `dsh-web-app` / `@linxin666/dsh-web-all` |
| 第三方 | `dsh-better-sidebar 0.24.1` —— **已安装且正在运行**。⚠️ `cordis.patch.yml` 里那条 `- id: web-ui-better-sidebar / name: dsh-better-sidebar / disabled: true` 是**旧的手工挂载行**，它的 id 与实际挂载行（bundle 通道 `id: better-sidebar`）**不同** ⇒ 禁不掉它；运行时 boot 载荷的 bundle 清单里确实含 `dsh-better-sidebar/client.js`。profile 的 `//dsh-0.2.0-compat` 注释表明这是**有意**钉到 0.24.1（它提供 `betterSidebar` 服务） |
| 本插件安装 | profile 用 `file:…/plugin/web/dsh-shinki-sidebar-tools`；pnpm 默认**硬链接**进 `.pnpm` store 并让 `node_modules/<pkg>` 指向它 ⇒ 需独立副本时用 `tools/deploy-independent.py` |

### 0.1 现场如何区分「两套底部栏」

界面上会同时存在两套底部栏（本插件的 + better-sidebar 的），按下表即可判定归属：

| | 本插件的底部栏 | better-sidebar 的底部工作台 |
|---|---|---|
| DOM | `#shinki-tools-panel` / `#shinki-bp-overlay` | `[data-dsh-bottom-panel]`（它的开关是 `[data-dsh-bottom-toggle]`） |
| 类名 | 本插件自绘（`shst-*`） | `.nArs4W_bottomPanel` / `..._bottomClose` / `..._bottomResize`（哈希前缀随版本变） |
| 内容 | 本插件注册的视图 TAB（JS OTA、串口监控、蓝牙、SVN/Git 图 …） | 它自带的 builtin TAB（终端、任务管理、上传/下载、SSH 远端主机 …） |
| 归属 | **本插件**（自绘，`z-index:100`） | **第三方 `dsh-better-sidebar`**（**不是官方**） |

> **官方没有整条底部栏**。官方只有两处「底部区域」：① 右侧栏内部的「下分栏」—— `dock.drop.bottom`
> （把 tab 拖到某个 pane 底部 ⇒ 右栏内部上下两格，仍是右栏，来自 `dsh-client-ui-sidebar-right`）；
> ② 输入框下方的官方小条目 dock —— `conversation.composer.dock` / `conversation.input.dock`
> （Todo / Goal / 队列 / cordis runner 等，来自 `dsh-client-ui-chat`、`dsh-client-ui-conversation`、`dsh-cordis-client-runner`）。

> 若将来真要关掉 better-sidebar 的底部工作台：删掉 profile `package.json` 里 `dsh.profile.bundles` 的 `dsh-better-sidebar`，
> 或在 `cordis.patch.yml` 里按**正确的 id** 加一行禁用（`- id: better-sidebar` + `disabled: true`）——
> 仅禁用 `web-ui-better-sidebar` 那条旧手工行是无效的。注意：本插件 6 个消费方的激活**不再依赖**它。

## 1. 形态支持矩阵（实际实现，非计划）

| 形态 | 实际实现 | 入口 | 状态 |
|---|---|---|---|
| `bottom` | 本插件**自绘面板**（挂在 `<body>`、`position:fixed`、`z-index:100`）：顶部拖拽握把（hover 高亮 + 拖动 HUD）、TAB 条（每视图 ✕）、`＋` 下拉、✕ 隐藏；让位 = 会话列 `margin-bottom`；滚动由 CSS `overflow:auto` 按内容高度决定 | ≡ 菜单「底部面板」/ 会话右上角开关 / `＋` 下拉 / 打开视图时按注册信息路由 | ✅ 实测通过（滚动、拖高、按会话状态） |
| 官方右栏（`sidebarRightTabs` + `sidebar.right.pane.tab`） | 官方 seat 承载：`slotHostView` = portal + **真实 `container`（首帧可用）** + `close/setTitle/isDetached` + 错误边界；`overflow:auto` 承接视图溢出 | 官方「+」/ ≡ →可创建 / 打开视图的右栏路径 | ✅ 6 个插件在用 |
| `mainView` | 官方 `conversation.view` 槽位注册（与「对话/轨迹」同级），`slots.register(options, Component)` 第二参数传组件 | 官方视图切换器 | ✅ 已注册（music 在用） |
| `popup` | 默认**面板内全屏承载**（自绘标题栏 + ✕ + Esc，含滚轮兜底）；`openPopupWindow()` 真窗口仅保留 | ≡ →独立弹窗 / `openPopup(id)` | ✅ 已验证；真窗口在本宿主 QtWebEngine 下不可靠（会被当成本页导航） |

> ⚠️ **`right` 不是形态名**：`VIEW_FORMS` 实际只有 `popup / bottom / mainView`。
> 消费方写的 `targets:['bottom','right']` 里那个 `right` 会被记一条「未知形态已跳过」，
> **右栏入口实际是 `bottom` 形态的实现顺带注册的**。只写 `targets:['right']` 目前拿不到入口 —— 见 §6 #1。

## 2. 消费方适配矩阵（6 个插件 / 8 个视图）

| 插件 | 视图数 | targets | background | 依赖的 props（实测读法） | 状态 |
|---|---|---|---|---|---|
| `dsh-shinki-music` | 1 | `popup, mainView` | `force` | `background` + 生命周期；右栏由它自己注册 | ✅ |
| `dsh-shinki-git-graph` | 1 | `bottom, right` | `pause` | `store.getPrefs/setPrefs/get/set/subscribe`、`scope.sessionId/cwd`、`visible` | ✅ |
| `dsh-shinki-serial-monitor` | 2 | `bottom, right` / `bottom` | `pause` | `store.update(tab.id,{meta})`、`tab.meta`、`visible` | ✅ |
| `dsh-shinki-svn-graph` | 1 | `bottom, right` | `pause` | `scope.sessionId`、`store.getPrefs/setPrefs` | ✅ |
| `dsh-shinki-js-ble-tool` | 1 | `bottom, right` | `pause` | **`visible`（记录/状态轮询的闸门）**、`scope`/`tab`/`store` | ✅ |
| `dsh-shinki-ble-tool` | 2 | `bottom(, right)` / `bottom` | `pause` | `scope`/`tab`/`store`/`visible` | ✅ |

> 全部 6 个都是「新模式一句声明 + 老模式 `waitService(ctx,'betterSidebar')` 兜底」。
> better-sidebar **实际在运行** ⇒ 这条兜底会被装上（它的服务存在），但 `viaAdapter` 一旦为真就提前 `return`
> ⇒ **不会重复注册**（所以它的工作台里不会出现这些视图的重复 TAB）。

## 3. props 契约（本层实际注入，三条承载路径一致）

| 字段 | 来源 | 说明 |
|---|---|---|
| `container` | 适配层 | 底部栏 = 面板内容容器 DOM；右栏 = portal 目标节点（首帧即可用）；弹窗 = 承载 host |
| `form` | 适配层 | `'bottom' \| 'mainView' \| 'popup'` |
| `close()` | 适配层 | 底部栏 = 收起面板（视图保持挂载）；弹窗 = 关窗；官方槽位 = 宿主掌管，只告警 |
| `setTitle(t)` | 适配层 | 底部栏 TAB/≡菜单即时生效；右栏已打开的 chip 由宿主捕获（需重开该 tab） |
| `isDetached` | 适配层 | 弹窗形态为 `true` |
| `background` | 适配层 | `pause`(默认) / `remember` / `stop` / `force` |
| `visible` | better-sidebar 口径合成 | 恒 `true`（我们只在可见容器里渲染它）——消费方靠它开轮询 |
| `scope` | 同上 | `{ sessionId: <会话 key>, cwd: '' }` |
| `tab` | 同上 | `{ id: 'shinki:<viewId>', type, title, meta }`，`meta` **按会话**持久化 |
| `store` | 同上 | `get/set/getPrefs/setPrefs/update/updateTab/subscribe/getSnapshot`；`get/set/updateTab(meta)` 按会话，`prefs` 全局 |

## 4. 按会话隔离状态（用户需求：状态跟着对话走）

| 项 | 实现 |
|---|---|
| 存储 | `localStorage['dsh-shinki-tools:v1:<sessionId>']` = `{open, height, tabOrder, active, values}`（`values` 里放消费方设置与 `tab.meta`） |
| 会话 key | `ctx.get('uiSession').adapter.current.getSnapshot().key`（**订阅** + 1s 轮询兜底）；解析不到用 `'default'` 并退化为全局行为；启动早期解析成功算"迁移"而非切换 |
| 新会话默认 | **收起** + 高度 220（对齐 better-sidebar `makeDefaultState`） |
| 高度契约 | 夹在 `[120, 可见视口 − 280]` |
| 写盘 | 每会话一个 200ms 防抖定时器 |
| 逃生口 | URL 加 `?dsh-shinki-reset` ⇒ 丢弃该会话的面板状态 |
| 跨会话共享 | 仅 `store.getPrefs/setPrefs` → `localStorage['dsh-shinki-tools.prefs.v1']`（与参考实现一致：prefs 全局） |
| 视图内部状态 | **不隔离**（面板不 remount，切会话保持）；消费方若要"每会话一套"，需自己按 `scope.sessionId` 分桶 |

## 5. 关键不变量（踩坑后固化）

1. **让位只写会话列 `margin-bottom`**（`--dsh-shinki-bottom-height`）；不给滚动容器/`body`/`html` 加 padding（滚动容器的底 padding 会在会话末尾留一条能滚进去的空白）。
2. **显示面板一律 `display:'flex'`**，绝不写 `style.display = ''`：`''` 会清掉内联 `display:flex` ⇒ 面板变 `block` ⇒ 宿主 `flex:1 1 auto;min-height:0` 全失效 ⇒ 宿主高度=内容高度、被面板裁掉，而宿主自身不溢出 ⇒ 浏览器判定"不用滚动条" ⇒ 内容永远够不着。
3. **宿主尺寸不写死**：交给 flex 按面板实际高度分配 ⇒ 拖高/字体/工具栏变化自动跟随。
4. **滚动由 CSS 决定**：宿主 `overflow:auto` + 视图根 `height:auto !important`（内容高就出滚动条）；JS 只保留**滚轮兜底**（含 `deltaX`/Shift+滚轮，且覆盖 `overflow:hidden` 的"裁切型"容器）。
5. **面板宿主挂 `<body>`**（避免会话 DOM 里 `transform/contain/filter` 把 `position:fixed` 的包含块劫持走）；`z-index:100`（高于会话内容与其浮动层 60，低于菜单 1100 / 本插件菜单 / FAB）。
6. **错误边界**：消费方渲染抛错 ⇒ 面板就地显示原因 + 重试，不再整块空白。
7. 面板按**可见视口**（`innerHeight` / `visualViewport.height` / `documentElement.clientHeight` 取最小非零）定位与限高。

## 6. 待办 / 已知缺口

| # | 事项 | 说明与建议做法 |
|---|---|---|
| 1 | `targets:['right']` 无效 + 「未知形态已跳过：right」噪音 | 把右栏注册（`sidebarRightTabs.register` + `sidebar.right.pane.tab`）从 `bottom` 实现里抽成共用函数，新增 `VIEW_FORMS.right` 调它；重复注册用 try/catch 吞 `already registered` |
| 2 | `dsh-shinki-serial-monitor` 老模式残留 | 其内部仍直接读 `ctx.betterSidebar.*`（`updateTab`/`getSnapshot`）⇒ cordis 拒绝属性访问、功能静默降级；建议改 `ctx.get('betterSidebar')` 或直接删除老模式分支 |
| 3 | 6 个消费方的老模式兜底分支 | 都还留着 `waitService(ctx,'betterSidebar') + setTimeout(1500)`；better-sidebar **当前是启用的**（见 §0），故该兜底会装但被 `viaAdapter` 短路；若决定彻底不用它，可整体删除（省一个定时器与一条日志） |
| 4 | 右栏**已打开** chip 的标题 | `setTitle(t)` 影响不了宿主已捕获的 chip（需重开该 tab）——已在契约里如实说明 |
| 5 | `mainView` 的 `close()` | 官方视图切换器由宿主掌管，本层只能告警 |
| 6 | 视图内部状态不按会话隔离 | 见 §4；消费方按 `scope.sessionId` 自行分桶即可 |
| 7 | `popup` 真独立窗口 | 本宿主 QtWebEngine 下 `window.open` 会被当成本页导航 ⇒ 默认走"面板内全屏承载" |

## 7. 验证与部署（护栏）

```bash
# ① 语法（必要不充分）
node --check <pkg>/lib/client.js

# ② 冒烟（必要）：桩环境真实加载 bundle 并调用 apply
node tools/smoke-client.mjs <pkg>/lib/client.js [更多 client.js ...]

# ③ 契约/行为回归：163 项断言（props / 按会话 / 两轴滚动兜底 / 拖拽热区 / 层次 / 纯 CSS 尺寸 / 错误边界 / 菜单项）
node tools/verify-props-contract.mjs [<pkg>/lib/client.js]

# ④ 独立副本部署（断开 pnpm 的硬链接与符号链接；默认干跑，--apply 执行并自校验）
python3 tools/deploy-independent.py [--apply]
```

> 再次 `pnpm install` 后 pnpm 会重建自己的链接布局；需要独立副本时重跑 ④。
