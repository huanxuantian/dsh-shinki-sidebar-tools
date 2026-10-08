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

> **进度（2026-10-06）**：第 1–5 步均已完成 —— 能力自足（横向滚动 / ≡ 全部视图 / 菜单边界自适应）、
> `bottom` 自实现、打开路径官方优先、6 个插件全部切到一句声明且无功能缺失。
> 当时 `dsh-better-sidebar 0.24.1` 仍在运行（旧手工行的 disable 无效）⇒ 上述回归是在「**它同时存在**」的条件下取得的；
> 该插件已于 2026-10-08 停用（见 [`docs/adaptation-status.md`](docs/adaptation-status.md) §0.2）。

### 现状（已具备的基础）

- 打开视图：`sidebarRight.openTab` 优先，`betterSidebar` 的方法名探测**仅作兜底**（5 处引用，全部在兜底分支）
- 视图发现：**动态**读官方注册表 `sidebarRightTabs.entries()`，硬编码清单只在枚举失败时兜底
- 与 `dsh-shinki-music` **无强依赖**（双向审计通过）：音乐插件自带四个入口，本插件也可独立工作

## 三种视图形态的支持方案（对接官方 API / 参考 better-sidebar）

目标：本插件除"右侧边栏可达性增强"外，进一步提供**三种扩展视图形态**，并逐步摆脱对第三方
`dsh-better-sidebar` 的依赖。以下为**依据实测源码得出的接入口**（非猜测）。

> **2026-10-06 现状（本节已被实现超越，以 [`docs/adaptation-status.md`](docs/adaptation-status.md) §1 为准）**：
> 三种形态**均已落地**，且实现方式与当时的"待确认"不同 ——
> 形态 A → **自绘底部面板**（官方并无下方面板槽位；浮层降级方案被弃用后改为自绘实体面板）；
> 形态 B → 走官方 **`conversation.view`** 槽位（不是 `registerTrajectoryConversationView`）；
> 形态 C → 默认**面板内全屏承载**（真 `window.open` 在本宿主 QtWebEngine 下会被当成本页导航）。
> 本节保留当时的侦察结论作为背景。

### 形态 A：下方扩展视图（bottom panel tabs）

| 项 | 内容 |
|---|---|
| better-sidebar 现状 | `ctx.betterSidebar.registerTab({ id, title, order, single, createTab, component })`；**注册 id 必须等于 `createTab().tab.type`**（本项目踩过：不等会报"插件未加载，标签页暂不可用"） |
| 自实现要点 | 下方容器属于 third-party 自绘 ⇒ 自实现需**自己渲染底部面板**并挂到官方槽位；待确认项：`@deepseek-ai/dsh-client-ui-layout` 是否暴露下方面板槽位（下一步先读它的 `lib/client.js` 槽位清单） |
| 兼容策略 | 先提供 `registerBottomTab` 等价 API，内部**优先官方槽位**，无槽位时降级为自绘浮层 |

### 形态 B：主视图模式（与「对话 / 轨迹」同级）

| 项 | 内容 |
|---|---|
| 官方接入口 | **`@deepseek-ai/dsh-client-ui-trajectory`** 暴露 **`registerTrajectoryConversationView(...)`**（该包 `lib/client.js` 内可见 2 处调用样例），并配合 **`ctx.slots.register/inject`** 注入视图内容 |
| 参考 | better-sidebar 的 `dsh.client.inject` 含 `@deepseek-ai/dsh-client-ui-conversation`，即"主视图模式"这一层由官方 conversation/trajectory 包掌管 |
| 自实现要点 | 用 `registerTrajectoryConversationView` 注册一个 mode 视图 + 用 `slots` 注入 React 组件；**需先读该包签名**（参数形状：id/title/render/order 待确认） |
| 风险 | 该 API 属官方内部扩展点，跨版本可能变动 ⇒ **必须做能力探测**（`typeof fn === 'function'`）并在缺失时只 `console.warn`，绝不阻塞宿主 |

### 形态 C：独立弹窗视图（detached window）

| 项 | 内容 |
|---|---|
| better-sidebar 做法（已验证） | **自建 host 路由**提供独立 HTML 页面：客户端可见 `/sidebar/html`、`/client/html`、`/bundle`；随后 `window.open(url, '_blank', 'noopener,noreferrer')` 打开 |
| 本插件落地 | 本插件已有 host 半边（`lib/index.js`）⇒ 增加 `GET /shinki-tools/html?...` 返回**自包含 HTML**（内联需渲染的 JS/CSS），客户端 `window.open` 打开；需要跨窗口同步时用 `BroadcastChannel` 或轮询 |
| 安全 | 复用回环信任栅栏（socket + Host 双校验）+ 仅允许白名单视图 kind，禁止任意 HTML/路径注入 |

### 落地顺序（与上文路线图对齐）

1. **形态 C（弹窗）** —— 最独立、与第三方零耦合，先做可最快验证 host 路由 + `window.open` 通路；
2. **形态 B（主视图模式）** —— 接官方 `registerTrajectoryConversationView`，做成"有就用、无则降级"；
3. **形态 A（下方视图）** —— 先确认官方槽位；若官方无槽位，则自绘面板 + 复用本插件浮动层能力。

> 每一步都遵守本插件既有约定：**能力探测 + 优雅降级 + 只 `console.warn` 不影响宿主启动**。

## 适配层契约：一句声明，落入多种视图形态

### 定位

本插件同时承担**多形态视图适配层（middleware）**：消费方插件**只声明一次**，由本插件负责把它
落到**下方视图 / 主视图模式 / 独立弹窗**等形态。**消费方不直接调用官方或第三方 API。**

### 为什么要这层

| 问题 | 由本层吸收 |
|---|---|
| DSH 破坏性更新 / 新特性（槽位改名、API 换签名、新增形态）| 只改**本插件一处**，已接入的插件**零改动** |
| 上游 `dsh-better-sidebar` 跟不上官方，或自身引入破坏性改动 | 本插件**优先官方实现**：右栏/底部/主视图/弹窗**都不再经过第三方**（`registerTab` 过渡桥已移除），仅「打开视图」的最后兜底分支保留第三方方法名探测；它已在本 profile 停用（2026-10-08），停用前后本插件四种形态均照常工作 |
| 每个插件各自对接多个视图形态，重复且易踩坑 | 统一契约 + 统一降级策略，接入成本降到一句声明 |
| 官方扩展点尚未稳定 | 能力探测 + 降级链，**缺失只是少一个形态，不阻塞插件激活** |

### 消费方 API（一句声明）

```js
// 消费方插件里只需这一句；与具体形态、官方 API、第三方插件均解耦
const handle = ctx.shinkiViews.register({
  id: 'my-plugin-view',            // 全局唯一；同名以先注册者为准
  title: '我的视图',                // 展示名（可传 i18n 文案）
  icon: MyIcon,                    // 可选
  order: 50,                       // 可选，形态内排序
  render: (props) => el,           // 渲染函数：接收稳定 props，返回 React 元素/节点
  targets: ['bottom', 'mainView', 'popup'],   // 想落到哪些形态；不支持者自动跳过
  mini: {                          // ★ v3：迷你 / 悬停窗口 —— **单独的迷你视图实现**（不复用 render）
    render: (props) => el,         //   独立实现；props 见下表（含 tier/width/height，据此换布局）
    defaultVisible: true,          //   可选，缺省 true：注册后默认以 240×80 显示在右下角
  },
});
// 卸载时：handle.dispose()
```

**稳定 props 契约**（保证同一 `render` 可被任何形态承载）：

| 字段 | 含义 |
|---|---|
| `container` | 承载容器（形态决定尺寸/位置）|
| `form` | 当前形态：`'bottom' \| 'mainView' \| 'popup'` |
| `close()` | 请求关闭/收起当前形态：底部栏=收起面板（视图保持挂载）；弹窗=关窗；官方槽位（右栏/主视图）的开关由宿主掌管，本层只告警 |
| `setTitle(t)` | 动态改标题：底部栏 TAB 条 / ≡ 菜单即时生效；官方右栏已打开的 tab 标题由宿主在 openTab 时捕获，需重开该 tab |
| `isDetached` | 是否运行在独立窗口（弹窗形态为 true，跨窗口通信走 `BroadcastChannel`）|
| `tier` / `compact` | **仅 mini**：当前规格档 `'s' \| 'm' \| 'l'`（最大 240×240 / 400×400 / 500×500）与是否紧凑条（默认 240×80）|
| `width` / `height` | **仅 mini**：当前盒子尺寸（px）——**布局必须按它自适应**（同一实现要能承载紧凑条与三档）|
| `maxWidth` / `maxHeight` | **仅 mini**：该档最大尺寸 |
| `setTier(t)` / `setCompact(b)` / `setOpacity(o)` | **仅 mini**：让消费方自己也能改规格/紧凑/透明度（等同控制条上的按钮/滑块）|

**字段覆盖矩阵**（上面五个字段在**任何**形态都拿得到；官方槽位缺的那几个由适配层补齐）：

| 承载 | container | form | close() | setTitle() | isDetached | 官方 kit |
|---|---|---|---|---|---|---|
| 底部栏（自绘面板）| 面板内容容器 DOM | `'bottom'` | ✅ 收起面板 | ✅ | `false` | — |
| 右栏 tab（sidebar.right.pane.tab）| 真实 DOM 节点（portal 目标，首帧可用）| `'bottom'` | ⚠️ 宿主掌管 | ✅（同上）| `false` | `sessionId`、`useTabInfo` 等原样透传 |
| 主视图（conversation.view）| 同上 | `'mainView'` | ⚠️ 宿主掌管 | ✅ | `false` | `inspectCall`/`openView`/`viewRequest`/`completeViewRequest` + kit |
| 弹窗 / 面板内全屏 | 承载 host DOM | `'popup'` | ✅ 关窗 | ✅ | `true` | — |
| 迷你 / 悬停窗口（v3）| 承载 body DOM（独立 React root）| `'mini'` | ✅ 关闭迷你窗 | ✅ | `false` | — + `tier/width/height/maxWidth/maxHeight/setTier/setCompact/setOpacity` |

> **better-sidebar 口径的 props 也已由本层合成注入**：`visible`（恒 true，消费方靠它开轮询）、
> `scope`（`{sessionId, cwd}`）、`tab`（`{id,type,title,meta}`）、`store`（`get/set/getPrefs/setPrefs/update/updateTab/subscribe/getSnapshot`）。
> 7 个消费方都是从 better-sidebar 迁来的（最后一个 `dsh-can-tool` 于 2026-10-08 迁完），实际读的就是这套（例：`store.updateTab(tab.id,{meta})` 存每视图设置）。
> 其中 `tab.meta` 与 `store.get/set` 落在**按会话状态**里，`store.getPrefs/setPrefs` 为全局；
> 右栏/主视图路径上官方 slot 的 kit（`useStore`/`sessionId`/`useTabInfo`）仍原样透传。

### 适配层内部：形态 → 实现（按优先级探测）

| 形态 | 实现优先级 |
|---|---|
| `bottom` | **本插件自绘面板**（挂 `<body>`、`position:fixed`、`z-index:100`；拖拽握把 + TAB 条 + `＋` 下拉 + ✕）；让位 = 会话列 `margin-bottom`；滚动由 CSS `overflow:auto` 按内容高度决定。**已移除** better-sidebar `registerTab` 过渡桥 |
| 官方右栏 = 形态 **`right`**（2026-10-09 起；与 `bottom` 共用注册、同 id 去重；承载视图沿用 `form:'bottom'`）| `sidebarRightTabs.register` + `slots('sidebar.right.pane.tab')`；承载层 `slotHostView` 提供 portal `container`、`close/setTitle/isDetached` 与渲染错误边界 |
| `mainView` | 官方 `conversation.view` 槽位：`slots.inject('conversation.view', () => slots.register({name,id,order,label,inject}, Body))`（与「对话/轨迹」同级） |
| `popup` | 默认**面板内全屏承载**（自绘标题栏 + ✕ + Esc + 滚轮兜底）；真独立窗口 `window.open` 在本宿主不可靠，仅保留 `openPopupWindow()` |
| `mini`（v3）| **悬停 / 迷你窗口**：`<body>` 下 `position:fixed`（`z-index:9000`，低于菜单/FAB）、独立 React root；三档规格 **最大 240×240 / 400×400 / 500×500**，**默认 240×80 紧凑条锚右下角**（避开本插件 FAB）；hover 才显控制条、可拖动、可调透明度、✕ 关闭；**显示配置（位置/规格/透明度/可见性）与主窗口完全独立**，按「会话 + 视图」存在 `values.mini.byView`；**数据必须与主视图共享**（同一个 `store`，消费方不得复刻第二份状态）。**参考实现**：`dsh-shinki-music` 的 `MiniBody`（播放控制 + 曲目名跑马灯；播放数据上提为模块级 `PLAYER` store，全插件唯一 `<audio>`，主视图与迷你视图共用）|

**降级原则**：任一形态不可用 ⇒ 只 `console.warn` 并跳过该形态，**其余形态照常**，绝不抛错、绝不让宿主/消费方 `pending`。

### 兼容与版本

- 契约带版本：`CONTRACT_VERSION = 3`（v2 增加 `background` 后台策略、v3 增加 `mini` 悬停/迷你窗口；都缺省兼容旧行为）；适配层承诺同时支持 **N 与 N-1**，升级期不破坏存量插件。
- 能力探测而非版本号判断：一律 `typeof fn === 'function'` 实测，避免"看着有其实没有"。
- 所有注册句柄可 `dispose()`；插件卸载/热重载后可干净重注册。

### 迁移路线（与上文路线图一致）

1. 适配层上线 `register()`，`bottom` 先走 **betterSidebar 过渡桥**（存量行为不变）；
2. 实现 `popup`（零外部依赖，可独立验证 host 路由 + `window.open`）；
3. 接官方 `mainView`；
4. `bottom` 自实现，**禁用 `better-sidebar` 后回归验证**；
5. 消费方逐个切换为"一句声明"（首个：`dsh-shinki-music`），完成后再评估是否彻底移除过渡桥。

> **进度（2026-10-06）**：5 步全部执行完毕 —— `bottom` 已自绘实现且**过渡桥已移除**；`popup`/`mainView` 已落地；
> 7 个消费方（9 个视图，含最后完成迁移的 `dsh-can-tool`）全部切到一句声明；回归先在 `dsh-better-sidebar` 同时运行时通过，随后它被停用。

## 实现进度（适配层）

**现状快照见 [`docs/adaptation-status.md`](docs/adaptation-status.md)** —— 形态 × 实现 × 入口 × 状态、
7 个消费方 / 9 个视图的适配矩阵、props 契约、按会话状态、关键不变量、待办，都在那一份里。

一句话：四种承载（**底部自绘面板 / 官方右栏 seat / `conversation.view` / 弹窗·面板内全屏**）均已落地并实测通过；
7 个消费方（music、git-graph、serial-monitor、svn-graph、js-ble-tool、ble-tool、can-tool）全部走「一句声明」。

> ⚠️ **`dsh-better-sidebar 0.24.1` 已于 2026-10-08 按用户要求停用挂载**（`dsh.profile.bundles` 摘除 +
> `cordis.patch.yml` 按**正确 id** `better-sidebar` 的禁用行 —— 旧写法 `web-ui-better-sidebar` 是历史手工挂载行、id 不同 ⇒ 禁不掉它）。
> 停用前它与本插件并存「两套底部栏」（本插件 `#shinki-tools-panel` vs 它的 `[data-dsh-bottom-panel]`）；
> 因它原先的硬依赖方 `dsh-can-tool` 已迁移到本适配层，停用后无插件 pending。依据/做法/回退见
> [`docs/adaptation-status.md`](docs/adaptation-status.md) §0.2。

### 经验记录（避免重复踩坑）

1. **服务必须 `provide`**：`ctx.shinkiViews = …` 会抛 `cannot set property "…" without provide`；且**必须用 try/catch 暴露出来**，否则会被静默吞掉。
2. **`≡` 菜单与右键菜单是两套代码**（`openAllViews` / `showMenu`）⇒ 共用逻辑要抽函数，改一处不够。
3. **菜单可滚动**（`maxHeight = vh-16` + `overflowY:auto`）⇒ 新增分区要放**最前**，否则会被挤出可视区。
4. **QtWebEngine 的 `window.open` 不可靠**：会把调用当成本页导航 ⇒ 弹窗类形态应以**面板内承载**为默认，真窗口作为可选项。

## mainView 接入点（已读源码确认）

来源：`@deepseek-ai/dsh-client-ui-trajectory/lib/client.js`（官方包，只读侦察）。

### 真实扩展点

```js
// 官方内部函数本身就这一句：
function registerTrajectoryConversationView(ctx) {
  ctx.uiConversation.views.register(trajectoryViewDefinition);
}
```
⇒ **主视图（与「对话 / 轨迹」同级）的注册入口是 `ctx.uiConversation.views.register(definition)`**，
而非某个专用 API；`uiConversation` 由官方包 `@deepseek-ai/dsh-client-ui-conversation` 掌管
（trajectory 包的 `dsh.client.inject` 里正是它）。

### 官方轨迹视图自身的注册写法（可照抄的范式）

```js
ctx.uiSession.provide({ hooks: ["trajectory"], resolve: … });

ctx.slots.inject("conversation.view", () => ctx.slots.register({
  name: "conversation.view",
  id: "trajectory",
  order: 10,
  locale: NS,
  label: () => t("view.trajectory"),      // ← 同级 tab 的标题
  children: { "conversation.trajectory.…": … },   // ← 该视图的内部槽位
}));
```

### 适配层的实现计划（含已知风险）

1. `waitFor(ctx, ['uiConversation', 'slots'], …)` —— **用运行时探测取服务，不写进 `dsh.client.inject`**
   （教训：把无法从 profile 解析的包写进 inject 会导致**整个 client graph 起不来**）；
2. `svc(ctx,'uiConversation').views.register({ id: spec.id, order: spec.order, label: () => spec.title })`；
3. `slots.inject('conversation.view', () => slots.register({ name: 'conversation.view', id: spec.id, order, label, children: {…} }))`；
4. 全部包在 `typeof … === 'function'` 能力探测里，缺失只 `console.warn` 并跳过该形态。

**待确认（实现前必须先读）**：`views.register(definition)` 的完整字段形状（`trajectoryViewDefinition` 的定义体）
与视图 body 对应的 `children` 槽位映射 —— 否则会出现"tab 出现了但内容是空的"。

## 契约 v2：后台生命周期（供任意插件复用）

原则：**插件只声明"想要什么行为"，暂停/继续/停止的派发由本中间件实现**。

### 声明式（随视图注册，自动登记）

```js
ctx.shinkiViews.register({
  id, title, render, targets,
  background: 'force',                 // 'pause'(默认) | 'remember' | 'stop' | 'force' | true | false
  onSuspend: ({ policy }) => { … },    // 视图卸载：pause / remember 时调用
  onResume:  ({ policy }) => { … },    // 视图重新挂载
  onStop:    ({ policy }) => { … },    // policy === 'stop' 时调用（缺省回退 onSuspend）
});
```

### 命令式（适合后台任务这类非视图资源）

```js
const h = ctx.shinkiViews.lifecycle.register('my-task', { onSuspend, onResume, onStop });
ctx.shinkiViews.lifecycle.dispatch('my-task', 'suspend', 'pause');
ctx.shinkiViews.lifecycle.policies();   // ['pause','remember','stop','force']
ctx.shinkiViews.lifecycle.keys();
h.dispose();
```

### 派发语义

| 策略 | 卸载 | 重新挂载 |
|---|---|---|
| `force` / `true` | **不动作**（继续后台运行）| `onResume` |
| `pause`（默认）/ `remember` | `onSuspend(policy)` | `onResume` |
| `stop` | `onStop(policy)`（无则回退 `onSuspend`）| `onResume` |

### 实现方式

`wrapView(spec, form)` 在**三种形态**（bottom / mainView / popup）中统一包装消费方 `render`：
挂载时派发 `onResume`、卸载时按策略派发 `onSuspend`/`onStop`，并注入 `props.background`
⇒ 插件无需手写生命周期。已用于 `dsh-shinki-music`（`background:'force'`，切视图不断播）。

## 待办（现状与做法见 [`docs/adaptation-status.md`](docs/adaptation-status.md) §6）

| # | 事项 | 状态 |
|---|---|---|
| 1 | 隐藏自检视图 `dsh-shinki-tools:sandbox` | ✅ 已**整块移除**（不再出现在任何菜单/可创建清单里） |
| 2 | `serial-monitor` 的 4 处 `ctx.betterSidebar.*` | ⏳ 仍在：better-sidebar 已禁用 ⇒ 属性访问被 cordis 拒、功能静默降级（不崩）；建议改 `ctx.get('betterSidebar')` 或删老模式分支 |
| 3 | `bottom` 自实现 | ✅ 已完成（自绘面板；让位/滚动/层次/按会话状态均实测通过） |
| 4 | 其余插件接入 | ✅ 已完成（`js-ble-tool` / `ble-tool` 也已在"新模式"注册，共 6 插件 8 视图） |
| 5 | `force` 短路的可观测性 | ✅ 已解决（派发留痕） |
| 6 | `targets:['right']` 无效 + 「未知形态已跳过：right」噪音 | ⏳ 新增：右栏注册从 `bottom` 实现抽成共用函数并新增 `VIEW_FORMS.right`（详见 status §6 #1） |

### 迁移新插件时的固定顺序（血泪教训，勿搬移）

```
① tabOptions（纯数据，最先构造）
② let viaAdapter = false（声明必须先于任何引用）
③ waitService(ctx, 'shinkiViews', …)  ← 新模式；不得放进定时器
④ waitService(ctx, 'betterSidebar', sb => setTimeout(() => { if (viaAdapter) return; sb.registerTab(tabOptions); }, 1500))
```
> `node --check` **查不出**作用域/时序错误（实践中有三轮教训：`tabOptions is not defined`、`viaAdapter` TDZ、
> 新模式块被塞进 `setTimeout`）。因此：**整体重写 `apply`**、改完做**位置序核对**，不要外科式搬移代码块。
> 另：`bottom` 形态必须 `waitFor(betterSidebar)`（否则早注册的消费方 Tab 会消失 —— 实测 svn-graph）。

## 改插件客户端代码的强制流程（护栏）

`node --check` **只能查语法**，查不出作用域/时序/TDZ/未定义变量等**运行时**错误 —— 本项目因此出现过
`tabOptions is not defined`、`viaAdapter` TDZ、新模式块被塞进 `setTimeout`、
以及"自动抽取 options 导致 `createTab` 函数头被截断 ⇒ 插件 failed"等故障，
其中一次直接造成 `web boot: 1 entry did not activate` ⇒ **profile 起不来**。

**因此：任何插件 `lib/client.js` 的改动，落盘（同步到运行时）前必须跑冒烟测试。**

```bash
# 语法（必要但不充分）
node --check <pkg>/lib/client.js

# 冒烟（必要）：桩环境真实加载 bundle 并调用 apply，捕获运行时错误
node tools/smoke-client.mjs <pkg>/lib/client.js [更多 client.js ...]
#  ✅ 输出 "加载 + apply 成功" ⇒ 允许同步
#  ❌ 输出 "❌ <pkg>: <错误>"    ⇒ 禁止同步，先修
```

冒烟测试 `tools/smoke-client.mjs` 会：桩化 `window.__ModuleLoader__` / `document` / `react` / `localStorage` /
`Audio` / `MutationObserver` 等，加载 bundle（`factory(require)`）并调用 `apply(桩 ctx)`，
同时捕获 `effect` 回调抛错 ⇒ 覆盖"能加载"与"能激活"两件事。

契约/行为回归测试 `tools/verify-props-contract.mjs`（163 项断言：props 契约、按会话状态、两轴滚动兜底、
拖拽热区、层次、纯 CSS 尺寸契约、渲染错误边界）：

```bash
node tools/verify-props-contract.mjs [<pkg>/lib/client.js]
```

### 部署：不要依赖 pnpm 的链接布局

pnpm 会把源码**硬链接**进 `.pnpm` store，并让 `node_modules/<pkg>` 指向它 ⇒ 源码 / 安装源 / 运行时
实际是**同一份文件**，排查时极易误判"改的到底是哪一份"。要三处各自独立（inode 不同、nlink=1）：

```bash
python3 tools/deploy-independent.py            # 干跑：报告现状 + 三处 md5
python3 tools/deploy-independent.py --apply    # 从源码整树复制（含把运行时符号链接换成真实目录）
```

注意：再次 `pnpm install` 后 pnpm 会重建自己的链接布局；需要独立副本时重跑本脚本。

### 另外两条硬性约定（血泪）

1. **不要用脚本自动抽取/搬移代码块**（尤其 options 对象）—— 抽取边界极易偏移而产生"语法合法但语义错"的代码；
   要改就**整体重写 `apply`**、options **逐字段手写**。
2. **顺序固定不可搬移**：`① options（纯数据）→ ② let viaAdapter → ③ waitService('shinkiViews')（立即）
   → ④ waitService('betterSidebar') + setTimeout 回落`；改完做**位置序核对**（新模式块不得落在定时器内）。

## `bottom` 自实现的关键线索（已侦察，勿丢）

> **更正（重要）**：`@deepseek-ai/dsh-client-ui-dockkit` 经复核是**类型词汇表包**（目录为空、仅被
> `import type` 引用）—— 它**不是**运行时服务，不能用来挂面板。真正实现停靠的是
> **`@deepseek-ai/dsh-client-ui-sidebar-right`**（内部有 `dock`/`docked`/`dockPaneIds`/
> `activeDockPaneId`/`dockFloat` 实现，对外暴露 `openTab`/`openTabIn`/`openWithPaneFocus`/`dockFloat`）。
> 因此 `bottom` 自实现的目标是 **`ctx.sidebarRight` 的 pane/dock API**。

目标是让 `targets: ['bottom']` **不再经过 better-sidebar 过渡桥**，从而彻底移除第三方依赖。

### 官方正主：`@deepseek-ai/dsh-client-ui-dockkit`

侦察方式：类型声明 `.../dsh-client-ui-sidebar-right/lib/types/**/*.d.ts`。

| 证据 | 内容 |
|---|---|
| 独立包 | **`@deepseek-ai/dsh-client-ui-dockkit`**（注释自称 *The docking kit*）|
| 它导出的类型 | `PaneId` · `TabId` · `TabRecord` · `DockLabels` · `LayoutState` |
| 语义 | `focus.d.ts`: `readonly host: 'dock' \| 'float'`（**停靠** 与 **浮动** 两类宿主）|
| `sidebar-right` 的用法 | `client/labels.d.ts` 里 `dockLabels(t, split?, close?) → DockLabels`；`contract/slots.d.ts` 注明"每个 kind 的全部 tab，**无论 docked 还是 floating**" |
| `sidebar-right` 服务方法（可复用）| `openTab` · `openTabIn` · `openWithPaneFocus` · **`dockFloat`** · `dockPaneIds` · `activeDockPaneId` · `registerSidebarShortcuts` · `openRightbar` |

### 下一步（实现顺序）

1. 读 `dsh-client-ui-dockkit` 的 `.d.ts`，确认**注册一个 pane/tab 并指定停靠到底部**所需的最小调用；
2. 读 `dsh-client-ui-sidebar-right` 的 `contract/slots.d.ts`，找**底部 pane 的槽位名**（或 `dockPaneIds` 的语义）；
3. 用上述官方 API 替换中间件 `bottom` 形态里的 `waitFor(['betterSidebar']) + sb.registerTab(...)`；
4. 回归：三种形态照常 + **禁用 better-sidebar 后 Tab 仍落底部** ⇒ 之后即可从 profile 移除该第三方包（并查清此前"从 bundles 移除导致 profile 起不来"的原因）。

### 已验证的坑：不要给 `sidebarRightTabs.register` 传 `guide`

**两次实测**：一旦在注册里加 `guide: [{id, order, title, description}]`，「+」打开的**指南界面就变空白**
（撤掉即恢复）。因此：
- 中间件注册视图时**不传 `guide`**；
- "类型已注册但未打开"的视图，进入路径走**我们自己的 `≡ → 可创建`**（动态清单，已可用）；
- 若要重新支持 `+` 指南，须**先读官方 `SidebarRightGuideEntry` 的精确类型/实现**再动手，不可照搬字段名。

## 下方视图的探索结论与 C1 决策（重要，勿重复踩坑）

需求："串口/蓝牙等工具以**下方**为主要视图"（右侧栏太窄不便观测）。

### 已评估的官方途径

| 途径 | 结论 |
|---|---|
| `dock.drop.bottom`（官方侧边栏）| 语义是 **"下分栏"** —— 把**右侧栏内部**拆成上下两格，**仍是右侧栏** ⇒ 解决不了"太窄"的问题 ❌ |
| `conversation.composer.dock`（"Ambient entries below the composer card"，`list`/`session`）| 渲染方式是 `renderSlot('conversation.composer.dock', {})` ⇒ **不给任何 props**，期待"空 props 也能自渲染"的**小条目**（如官方 `TodoDock`/`QueueDock`）。把**整面板组件**（串口监控等，按 better-sidebar 的 `ctx/store/scope/tab/visible` 写的）直接塞入 ⇒ 抛错 ⇒ **整个会话区渲染崩溃**（实测）❌ |
| `conversation.input.dock` | 官方 `TodoPanel`/`QueueDock` 的实际落点；同样是"小条目"语义 ⚠️ |

### C1 决策（用户选定）

**不碰官方槽位**：工具视图继续通过 **官方右侧栏**（`sidebarRightTabs` + `slots('sidebar.right.pane.tab')`）与 **`≡ → 可创建`** 进入。
- ✅ 已验证可用、零第三方、会话区不受影响；
- 自绘"应用底部大面板"方案**已废弃并删除代码**（浮层+预留空间的近似方案观感与官方/better-sidebar 差异大，用户判定不可用）。

> **2026-10-06 更新**：上面这条**结论已被推翻** —— 按用户要求重新实现了自绘底部面板，它现在就是 `bottom` 的正式形态
> （挂 `<body>`、`z-index:100`、拖拽握把、按会话隔离状态、让位走会话列 `margin-bottom`、滚动完全交由 CSS）。
> 记在这里只为保留决策轨迹；当前实现与不变量见 [`docs/adaptation-status.md`](docs/adaptation-status.md) §1 / §5。

### 若将来仍要"底部"

只能走 **适配器包装 + React 错误边界 + 一次只加一个视图** 的谨慎路径（单个视图崩溃不得牵连会话区），且必须先读该槽位官方消费者的实现。
