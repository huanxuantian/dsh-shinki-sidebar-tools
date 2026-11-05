# dsh-shinki-sidebar-tools

DSH Web 的**侧栏增强与多形态视图工具箱**：挂在官方右侧边栏 tab 条、会话头部与自绘底部面板三处，
补上「视图被挤掉、横向看不到」的可达性问题；同时作为 `ctx.shinkiViews` 适配层，
让其它插件**一句声明**即可落到底部栏 / 官方右栏 / 主视图 / 弹窗 / 迷你窗。

范围声明：不接管官方侧栏实现、不改宿主代码；任何能力缺失只降级、只 `console.warn`，不阻塞宿主启动。

---

## 功能

| 区域 | 能力 |
|---|---|
| tab 条滚动 | 覆盖 `[class*="_stripTabs_"]`：`scrollbar-width:thin`、6px 可见滚动条、`touch-action:auto`，支持触控板 / 滚轮 / 拖滚动条 |
| 会话头部开关 | 在 `conversation.session.header.utilities` 注册 28×28 圆形按钮（▤ 底部栏 / ☰ 全部视图），无会话时不渲染，图标随面板状态同步 |
| 「≡」全部视图 | 右下角 FAB 枚举所有 tab 条里的 tab（带 `#序号`），点击 `scrollIntoView` 后模拟 click 激活；同一菜单含可创建视图（按插件分组、可折叠、带目标徽标）、底部面板开关、迷你视图与弹窗分区 |
| 指南入口 | 往 `sidebar.right.tab.guide.entry` 注入「创建视图」列表（「+」打开的就是指南） |
| 视图适配层 | `ctx.shinkiViews.register()`：`bottom` / `right` / `mainView` / `popup` / `mini` 五种停靠形态，统一 props，逐形态降级 |
| 底部面板 | 自绘 `#shinki-tools-panel`（挂 body 下，`z-index:100`）：TAB 条 + `＋` 下拉 + 拖拽握把 + 尺寸调整，状态按会话隔离 |
| 迷你 / 悬停窗 | 默认 240×80 紧凑条锚右下角（避开 FAB），可切 240×240 / 400×400 / 500×500，可拖动、缩放、调透明度 |
| 临时视图 | agent 工具 `sidebar_temp_view`：`register` / `update` / `unregister` / `list`，内容形态 `text` / `html` / `component`，`tmp-` 前缀、按会话归属、仅存内存 |
| 授权浮层 | 采集 `approval/asked` 进环形缓冲（`max 5 + 2`），右下角 `#shinki-toast-root` 提醒，点击经 `uiWorkspace.openSession` 跳会话 |
| 设置页 | `settings.section` 注册「侧栏工具」：浮层开关 / 最多条数 / 停留时长，写入 `plugin-data/dsh-shinki-sidebar-tools/toast.json` |

---

## 核心设计

**零注入 + 能力探测。** 浏览器半边不做服务注入（`exports.inject = []`），服务一律 `ctx.get()` 取、失败即跳过；
host 半边只 `inject: ['webServer', 'tools']`。任何一步异常都只 `console.warn`，宿主照常启动。
`ctx.shinkiViews` 用 `ctx.provide()` 声明，直接赋值会抛 `without provide`。

**一句声明，多形态承载。** 消费方只调 `ctx.shinkiViews.register({ id, title, render, targets, mini, background })`，
适配层按 `targets` 落到各形态：`bottom` 与 `right` 共用同一段注册（同 id 自动去重），
`mainView` 走官方 `conversation.view` 槽位，`popup` 默认**面板内全屏承载**（真 `window.open`
在本宿主 QtWebEngine 下会被当成本页导航），`mini` 用独立 React root 单独实现。
`CONTRACT_VERSION = 3`，承诺同时支持 N 与 N-1；一律 `typeof fn === 'function'` 实测，不看版本号。

**稳定 props 契约。** 每个形态都拿得到 `container` / `form` / `close()` / `setTitle()` / `isDetached`；
`mini` 额外有 `tier` / `compact` / `width` / `height` / `maxWidth` / `maxHeight` /
`setTier` / `setCompact` / `setOpacity`。better-sidebar 口径的 `visible` / `scope` / `tab` / `store`
也由本层合成：`tab.meta`、`store.get/set` 落在**按会话状态**，`store.getPrefs/setPrefs` 为全局。

**数据面只有两条只读链路。** 临时视图：宿主内存 store + `GET /shinki-sidebar-temp/views`，
客户端 1.5s 轮询并按 `version` 差量；授权提醒：`session/event` → 环形缓冲 →
`GET /shinki-sidebar-tools/approvals`，客户端 2s 轮询。这两处宿主态重启即清空；
落盘的只有浮层配置 `toast.json`，客户端另把面板状态 / 偏好 / 已展示 id 存进 localStorage
（`dsh-shinki-tools:v1:会话键` / `dsh-shinki-tools.prefs.v1` / `dsh-shinki-toast:seen:v1`）。
浮层**只提醒、不代替用户批准/拒绝**。

**会话切换必须重挂载。** 视图的 `scope.sessionId` 在挂载那一刻求值，之后不会自动更新；
对话切换后由 `bpRemountAll()` 重解析会话键并重建，官方右栏插槽则用 `key = 's:' + 会话键`
强制 React 卸载重建，避免"A 的工作区数据留在 B 的视图里"。

---

### 对接指南（其他插件如何接入）

本插件是「侧栏/视图框架」，其它插件通过下面三条通道接入，**都不需要改动本插件代码**。

#### 1. 注册自己的视图（推荐）

```js
// 等到服务就绪再注册，避免注入顺序问题
waitService(ctx, 'shinkiViews', (sv) => {
  const off = sv.register({
    id: 'my-plugin-view',        // 全局唯一
    title: '我的视图',
    order: 40,                    // 可选，决定 tab 顺序
    targets: ['bottom', 'right'], // 可停靠位置：bottom / right / mini / popup / mainView
    background: 'pause',          // 可选：视图隐藏时的后台行为
    render: (props) => h(MyView, props), // 返回 React 元素
    // 可选：后台生命周期（也可用 sv.lifecycle.register(key, {...}) 单独登记）
    onSuspend(policy) {}, onResume() {}, onStop() {},
  });
  // off() 可注销
});
```

`ctx.shinkiViews`（`CONTRACT_VERSION = 3`）暴露的方法：

| 方法 | 作用 |
|---|---|
| `register(spec)` | 注册视图，返回注销函数 |
| `open(id, 'bottom' \| 'right')` | 打开并切到该视图 |
| `openPopup(id)` / `popupables()` | 弹出窗口 / 列出可弹出视图 |
| `openMini(id)` / `toggleMini(id)` / `closeMini()` / `hideMini(id)` | 迷你（悬停）窗口控制 |
| `lifecycle.register(key, { onSuspend, onResume, onStop })` | 该视图的后台生命周期钩子 |

**视图根节点布局约定**：宿主对 `[data-shinki-view-body] > *` 会强制 `height:auto / overflow:visible`，视图要内部滚动时必须二选一：

```js
// 方式 A（推荐）：声明 opt-out，自行接管滚动
h('div', { 'data-shinki-view-selfscroll': '1',
           style: { height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' } }, …)

// 方式 B：外层普通 div 承接强制规则，内层 position:absolute; inset:0 铺满宿主 body
```

#### 2. 临时视图（agent 工具 `sidebar_temp_view`）

不用注册组件就能往会话里塞调试面板，`kind` 三选一：

| kind | 参数 | 说明 |
|---|---|---|
| `text`（默认） | `text` | 纯文本 |
| `html` | `html`（≤64KB） | 客户端用 `<iframe sandbox="allow-scripts">` 渲染，**不允许同源 fetch**（调不了插件路由） |
| `component` | `component`（JSON） | `{"pluginId":"…","componentId":"…","props":{…}}`，跑在宿主页面内，可正常调路由/服务 |

其它参数：`action`（register/update/unregister/list）、`form`（mini/right/bottom/popup/mainView）、`title`，mini 可给 `x/y/width/height`（≥160×60）。视图按会话隔离、重启即清。

#### 3. 注册可被临时视图引用的组件

```js
// 插件浏览器半边加载时执行一次
window.__shinkiTempComponents.register({
  pluginId: 'my-plugin',
  componentId: 'my-panel',
  label: '我的面板',          // 可选
  factory: (props) => h(MyPanel, props),   // 返回 React 元素
});
```

之后任意会话都可以用 `sidebar_temp_view` 的 `component` 形态引用它；找不到组件时面板显示「未注册的组件」提示而不是白屏。

#### 4. 与授权浮层的关系

授权浮层由本插件自己采集 `approval/asked` 并渲染，**其他插件无需对接**；如需自测浮层，可 `POST /shinki-sidebar-tools/approvals/test` 注入一条测试提醒。

---

## HTTP API（host 半边）

路由以 `ctx.webServer.register({ kind: 'prefix' })` 注册；本插件未额外实现回环 / Host 栅栏，
暴露面取决于宿主监听地址。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/shinki-sidebar-temp/views?session=&since=` | 临时视图快照；`since` 等于当前 `version` 时只回 `{version, views:null}`；缺 `session` 回 400 |
| GET | `/shinki-sidebar-temp/diag` | 诊断：`inject`、`services`、`tool`、`sessionsWithViews`、`version`；带 `?debug=1` 才附带 `lastReport` 与 `logs` |
| POST | `/shinki-sidebar-temp/report?debug=1` | 客户端回传诊断；无 `debug=1` 直接 403（避免常开写入面） |
| GET | `/shinki-sidebar-tools/approvals` | 授权提醒环形缓冲（新→旧） |
| POST | `/shinki-sidebar-tools/approvals/test` | 造一条测试提醒，供设置页自检 |
| GET | `/shinki-sidebar-tools/toast-config` | 读取浮层配置（非法值已钳到合法区间） |
| POST | `/shinki-sidebar-tools/toast-config` | 写入并回显规范化后的 `{ enabled, maxVisible, dwellMs }` |

`toast.json` 的默认值：`enabled=false`、`maxVisible=3`（1..10）、`dwellMs=8000`（3000..60000）。

---

## 目录结构

```text
dsh-shinki-sidebar-tools/
├── package.json            # dsh.bundle.patch + dsh.client(platform: web)；无运行时依赖
├── cordis.patch.yml        # 把插件行插进 profile roster
├── lib/
│   ├── index.js            # host 半边：注册两条前缀路由 + sidebar_temp_view 工具
│   ├── client.js           # 浏览器半边：滚动 / ≡ 菜单 / 适配层 / 面板 / 迷你窗 / 浮层 / 设置页
│   ├── temp-views-store.js # 临时视图内存 store（按会话归属、版本号、长度上限）
│   ├── temp-views-tool.js  # sidebar_temp_view 工具定义与参数校验
│   └── approvals.js        # approval/asked 环形缓冲 + toast.json 读写
├── docs/                   # 适配状态快照、临时视图工具、底部面板参考、授权浮层调研
└── tools/                  # 冒烟与契约自检、独立部署脚本
```

---

## 安装与生效

1. **部署**：把本目录放到 profile 可引用的位置（下文记作 `$PLUGIN_DIR`）。

2. **登记进 profile**（示例 profile 名 `shinki-desktop`）：

   ```sh
   dsh plugin --profile shinki-desktop add "file:$PLUGIN_DIR"
   ```

   包名会被写进 profile 的 `dsh.profile.bundles`，插件自带的 `cordis.patch.yml`（`dsh.bundle.patch`）
   作为 bundle 层生效。手工往 `cordis.patch.yml` 写 roster 行是**另一种**机制（设置页插件管理器用的），
   只写 roster 不会被 Loader 挂载。本地迭代可用 `link:$PLUGIN_DIR`（pnpm 符号链接，改完刷新即生效）。

3. **验证**：页面 boot 载荷里出现 `dsh-shinki-sidebar-tools/client.js`；右侧栏 tab 条出现细滚动条，
   右下角出现 `≡`；`dsh plugin --profile shinki-desktop list --depth 0` 能列出本插件。

4. **卸载**：`dsh plugin --profile shinki-desktop remove dsh-shinki-sidebar-tools`。

> ⚠️ `file:` 是**快照**：改源码后必须重跑第 2 步，或改用 `link:`。host 半边（`lib/*.js`）改动
> **必须重启** dsh web（bundle 成员与 host 代码都是启动边界）。

### 官方 DSH 桌面端的 profile 名（实测）

上面的示例用了自定义 profile 名。若目标是**官方 DSH 桌面端**，它启动的是固定名字 `desktop`
（`@deepseek-ai/dsh-desktop-host/lib/index.js` 的 `main()` 里
`runProfile({ profile: "desktop", args: ["--no-open", "--port", "19387"] })`），
目录是 `%USERPROFILE%\.dsh\profiles\desktop`：

```powershell
& 'E:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add `
  file:E:\path\to\dsh-shinki-sidebar-tools
```

**不要用 agent shell 里的 `DSH_HOME` / `DSH_PROFILE_DIR` 判断目标 profile**：机器上若还留着旧的
可移植（EAC）实例，它指向的是另外的 profile（本机是 `web-desktop`），装到那里官方客户端完全看不到。

两点与自定义 profile 不同的实测结论：

- **生效是热挂载**：`dsh plugin add` 完成后新 bundle 即挂进运行中的会话，**通常不必重启**；没生效再重启客户端。
- **验证**：设置 → 插件页（`pluginInventory`）能搜到 `dsh-shinki-sidebar-tools`；无会话时头部按钮不出现属正常。

---

## 环境要求

- **Node 20+**（`package.json` 的 `engines`），宿主进程提供 `webServer` 与 `tools` 两个服务。
- **无外部 CLI、无第三方运行时依赖**；`@deepseek-ai/dsh-tools` 可用时用其 `defineTool`，
  不可用时回退为最小包装（`parameters` 补 `type: 'object'`），工具仍能注册。
- 浏览器侧需要 `react`（`require('react')`，取不到时菜单等纯 DOM 能力仍可用）与
  `@deepseek-ai/dsh-client-modules` / `@deepseek-ai/dsh-client-locale`（见 `dsh.client.inject`）。

---

## 开发

```sh
node tools/verify-temp-views.mjs        # 临时视图：三种 kind、参数三选一、会话隔离、版本短路
node tools/verify-approvals.mjs         # 授权采集：重复派发去重、无 requestId 的稳定指纹、环形淘汰
node tools/verify-toast-client.mjs      # 浮层行为：当前会话不弹、历史不弹、已展示 id 落 localStorage
node tools/verify-props-contract.mjs    # props 契约 / 按会话状态 / 两轴滚动 / 层次 / 尺寸 / mini
node tools/smoke-client.mjs lib/client.js   # 桩环境真实加载 bundle 并调用 apply（冒烟护栏）
```

`node --test` 脚本仍在 `package.json` 里，但仓库当前没有 `tests/` 目录，实际上以 `tools/` 下的自检为准。

### 容易踩的坑

- **改 `lib/client.js` 必须跑冒烟**：`node --check` 只查语法，查不出作用域 / TDZ / 时序错误
  （历史上出现过 `tabOptions is not defined`、新模式块被塞进 `setTimeout`，直接导致 profile 起不来）。
- **服务必须 `provide`**：`ctx.shinkiViews = …` 会抛 `cannot set property … without provide`；
  且失败要 `try/catch` 打出来，否则会被静默吞掉。
- **`≡` 菜单可滚动**（`maxHeight = vh-16` + `overflowY:auto`）：新增分区要放**最前**，否则被挤出可视区。
- **QtWebEngine 的 `window.open` 不可靠**：会被当成本页导航 ⇒ 弹窗形态默认面板内全屏承载，真窗口只作可选项。
- **工具三契约**：`output.render` 必填（缺了注册直接失败）；`output.schema` 必须是标准 JSON Schema
  （带 `type/properties`）；`render` 签名是 `(args, value)`，只写一个参数会回显入参。
- **容器必须 `overflow: 'hidden'`**：否则子视图的 `height:100%` 被内容撑破，"表格变长后整个视图跟着滚"。
- **强制 CSS 的副作用**：宿主对 `[data-shinki-view-body] > *` 注入 `height:auto !important; overflow:visible !important`
  让面板整体滚动；视图想自己滚就给根节点加 `data-shinki-view-selfscroll="1"` opt-out。
- **不要给 `sidebarRightTabs.register` 传 `guide`**：两次实测一旦带上 `guide` 字段，「+」打开的指南界面变空白。
- **pnpm 硬链接会误导排查**：源码 / 安装源 / 运行时可能是同一份文件；需要独立副本时跑
  `python tools/deploy-independent.py --apply`（干跑不加 `--apply`，只报告现状与三处 md5）。

### 版本号

当前 **v0.2.6**（`package.json` 的 `version` 与 tag `v0.2.6` 一致）；分支沿用 git-graph 的策略：
`main` / `dsh0.2.0` / `dsh0.2.1`，当前开发分支是 `dsh0.2.1`。

策略：只在发布时 bump 版本并打 tag，纯文档 / 注释提交不动版本；`lib/client.js` 里**不重复硬编码**
版本号，`package.json` 是唯一来源。打包发布沿用 `files` 白名单（`lib`、`cordis.patch.yml`、`README.md`）。

---

## 许可

Apache-2.0

---

## 相关路线图（依赖提示）

- 已**无第三方强依赖**：`dsh-better-sidebar` 于 2026-10-08 停用，原过渡桥已移除，仅「打开视图」的最后
  兜底分支保留其方法名探测；服务缺失时只是少一个形态，消费方无需改动。
- 下游消费方（`dsh-shinki-svn-graph`、music、git-graph、serial-monitor、BLE / CAN 工具等）通过
  `ctx.shinkiViews.register()` 的一句声明接入；新增形态属于**本插件单点变更**。
- 待办与逐项判定标准维护在 [`docs/adaptation-status.md`](docs/adaptation-status.md)，本 README 不重复跟踪。
