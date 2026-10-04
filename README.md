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

## 三种视图形态的支持方案（对接官方 API / 参考 better-sidebar）

目标：本插件除"右侧边栏可达性增强"外，进一步提供**三种扩展视图形态**，并逐步摆脱对第三方
`dsh-better-sidebar` 的依赖。以下为**依据实测源码得出的接入口**（非猜测）。

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
| 上游 `dsh-better-sidebar` 跟不上官方，或自身引入破坏性改动 | 本插件**优先官方实现**，第三方仅作**过渡桥**；可随时禁用而上层不受影响 |
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
});
// 卸载时：handle.dispose()
```

**稳定 props 契约**（保证同一 `render` 可被任何形态承载）：

| 字段 | 含义 |
|---|---|
| `container` | 承载容器（形态决定尺寸/位置）|
| `form` | 当前形态：`'bottom' \| 'mainView' \| 'popup'` |
| `close()` | 请求关闭/收起当前形态（弹窗=关窗，主视图=切回）|
| `setTitle(t)` | 动态改标题 |
| `isDetached` | 是否运行在独立窗口（弹窗形态为 true，跨窗口通信走 `BroadcastChannel`）|

### 适配层内部：形态 → 实现（按优先级探测）

| 形态 | 实现优先级 |
|---|---|
| `bottom` | ① 官方下方面板槽位（待确认 `dsh-client-ui-layout`）→ ② 本插件自绘面板 → ③ **过渡桥**：`betterSidebar.registerTab` |
| `mainView` | ① 官方 `registerTrajectoryConversationView` + `ctx.slots`（与「对话/轨迹」同级）→ ② 跳过并 `console.warn` |
| `popup` | ① 本插件 host 路由 `GET /shinki-tools/html?view=<id>` 返回自包含 HTML → `window.open(url,'_blank','noopener,noreferrer')`（无外部依赖）|

**降级原则**：任一形态不可用 ⇒ 只 `console.warn` 并跳过该形态，**其余形态照常**，绝不抛错、绝不让宿主/消费方 `pending`。

### 兼容与版本

- 契约带版本：`CONTRACT_VERSION = 1`；适配层承诺同时支持 **N 与 N-1**，升级期不破坏存量插件。
- 能力探测而非版本号判断：一律 `typeof fn === 'function'` 实测，避免"看着有其实没有"。
- 所有注册句柄可 `dispose()`；插件卸载/热重载后可干净重注册。

### 迁移路线（与上文路线图一致）

1. 适配层上线 `register()`，`bottom` 先走 **betterSidebar 过渡桥**（存量行为不变）；
2. 实现 `popup`（零外部依赖，可独立验证 host 路由 + `window.open`）；
3. 接官方 `mainView`；
4. `bottom` 自实现，**禁用 `better-sidebar` 后回归验证**；
5. 消费方逐个切换为"一句声明"（首个：`dsh-shinki-music`），完成后再评估是否彻底移除过渡桥。
