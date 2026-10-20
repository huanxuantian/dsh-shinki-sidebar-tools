# 需求与实现计划：临时视图工具（sidebar_temp_view）

状态：**待确认，尚未实现**（本文只定义需求与方案）
日期：2026-10-20

## 1. 需求

给 `dsh-shinki-sidebar-tools` 增加一个 agent 工具，让 agent 可以在运行时**动态注册临时视图**：

- 临时视图只在**本次客户端运行期间**存在，重启后全部消失（不落盘、不进 manifest、不影响其它会话）；
- 支持三种操作：**注册**、**修改**（更新标题/文本/尺寸等）、**卸载**；
- 支持**列出**当前已注册的临时视图（便于 agent 自检与幂等更新）。

用途：调试与自检（例如临时把某段状态渲染成悬浮卡片观察），以及在不发版的前提下验证视图布局/绑定行为。

## 2. 非目标

- 不允许 agent 注入任意 JavaScript/HTML（安全边界：只接受**声明式数据**）；
- 不做持久化（明确是"临时"，重启即失效）；
- 不替代正式插件的 `registerView`（正式视图仍由插件代码注册）。

## 3. 待确认的三个设计选择

| 选择 | 建议 | 备选 |
|---|---|---|
| 视图形态 | `mini`（悬浮）为主，允许 `bottom` | 仅悬浮 |
| 绑定模式默认 | `session`（调试用，按会话隔离，不污染其它会话） | `global` |
| 内容形态 | 标题 + 纯文本（可多行） | 再加只读 JSON 折叠显示 |

## 4. 现状与约束（关键）

本插件目前是**纯客户端**：

```
lib/index.js    300 B    （几乎无宿主逻辑）
lib/client.js   190 KB   （全部视图逻辑）
package.json    dsh.host = null（未声明宿主能力）
```

因此"工具"（宿主侧）无法直接调用客户端代码，必须有**宿主 → 客户端**的通道。

DSH 0.2.1 已移除 `webRuntime`；`dsh-web` 以 `super(ctx, 'web')` 注册服务，老插件常用
`inject: ['webServer']`。**实现前必须先核实 0.2.1 中"注册 HTTP 路由"的准确服务名与签名**，
否则会再次出现"注入不满足 → 插件永不激活"的问题（0.2.1 升级时已经踩过一次）。

## 5. 架构

```
agent
  │  调用工具 sidebar_temp_view {action, ...}
  ▼
host: lib/index.js
  │  1) 校验参数（声明式，无代码注入）
  │  2) 写入内存 Map<id, spec>（进程内，不落盘）
  │  3) 递增 version 计数
  ▼
host: HTTP 路由  GET /plugins/<plugin>/temp-views?since=<version>
  │  返回 { version, views: [spec...] }
  ▼
client: lib/client.js  轮询（1.5s，版本未变则零成本返回）
  │  与本地 snapshot 做差量对齐：
  │   added   → registerView(ctx, spec)（记录 handle）
  │   changed → 更新 spec 并重建视图（dispose + register）
  │   removed → handle.dispose()
  ▼
UI: 视图出现/更新/消失（悬浮或底部面板）
```

选轮询而非推送：实现最简单、与现有插件风格一致（多处已用 `setInterval`），
1.5s 的延迟对调试场景足够；后续如有推送能力再替换。

## 6. 工具契约

工具名：`sidebar_temp_view`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | `register` \| `update` \| `unregister` \| `list` | 是 | 操作 |
| `id` | string | register 可省略；update/unregister 必填 | 视图 id；register 省略时自动生成 `tmp-<n>` |
| `title` | string | register 必填 | 视图标题（同时作为标签名） |
| `text` | string | 否 | 纯文本内容（等宽渲染，支持多行） |
| `target` | `mini` \| `bottom` | 否 | 默认 `mini` |
| `bind` | `global` \| `session` | 否 | 默认 `session` |
| `width` / `height` | number | 否 | 仅 `mini`，单位 px，受现有 tier 上限约束 |
| `visible` | boolean | 否 | 默认 `true` |

返回：`{ ok, id, version, views? }`（`list` 返回全部；其它返回受影响项）。

## 7. 数据模型（宿主内存）

```js
// 每次客户端重启，宿主进程重启 => 清空
const TEMP = { version: 0, views: new Map() };   // id -> {id,title,text,target,bind,width,height,visible,ts}
```

并发：单 agent 场景下无需锁；多 agent 同时改时以最后写入为准（文档标注）。

## 8. 客户端对齐逻辑

- 首次拉取：全量注册；
- 后续：按 `id + version` 对比；`version` 未变直接 return（避免频繁重建）；
- 卸载：调用 `registerView` 返回的 `handle.dispose()`，并清理本地 snapshot；
- 守卫：临时视图 id 统一前缀 `tmp-`，避免与正式视图冲突；若冲突则拒绝并提示；
- 若插件在 0.2.1 上未激活（注入问题），工具调用返回可读错误而不是静默失败。

## 9. 安全

- 只接受字符串/数字/布尔；**不执行**任何来自工具参数的内容；
- 文本按纯文本渲染（`textContent` 语义，不解析 HTML/Markdown）；
- 尺寸上限沿用 `MINI_TIERS`，防止撑爆界面；
- 不写文件、不写 localStorage（重启即消失是本需求的硬要求）。

## 10. 实现步骤与验收

| 步 | 内容 | 验收 |
|---|---|---|
| 0 | 核实 0.2.1 路由注册服务名与签名 | 写一个最小路由，`curl` 能取到 JSON |
| 1 | host：内存 store + 工具注册 + 路由 | 工具 `register` 后 `curl` 能看到记录 |
| 2 | client：轮询 + 差量对齐 | `register` 后 UI 出现视图；`unregister` 后消失 |
| 3 | `update` 语义（标题/文本/尺寸变化生效） | 改动后视图内容/尺寸更新，无需重启 |
| 4 | 重启验证 | 重启客户端后临时视图全部消失 |
| 5 | 幂等与边界 | 重复 register 同 id → 更新；非法参数 → 明确错误 |
| 6 | 文档 + 清单 | README 增补工具用法；manifest 重算并 `verify-install` 通过 |

## 11. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 0.2.1 路由服务名判断错误 | 插件不激活 | 步 0 先做最小验证 |
| 轮询造成额外开销 | 轻微 | 1.5s + 版本号短路；页面隐藏时暂停（`document.hidden`） |
| 临时视图泄漏（未 unregister） | 残留到重启前 | `list` 可见；支持一次性卸载全部 `unregister(id:'*')` |
| 与正式视图 id 冲突 | 覆盖风险 | 强制 `tmp-` 前缀 + 冲突拒绝 |

## 12. 确认清单（请回复）

1. 形态：`mini` 为主 + 允许 `bottom`？（建议是）
2. 绑定默认：`session`？（建议是）
3. 内容：标题 + 纯文本够用？（建议是；如需 JSON 折叠可后加）
4. 是否允许 `unregister(id:'*')` 一键清空？（建议是）
5. 工具名 `sidebar_temp_view` 是否合适？（亦可 `shinki_temp_view`）